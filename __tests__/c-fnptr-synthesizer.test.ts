import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { OmniWeave } from '../src';

describe('C function-pointer dispatch synthesis', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c-fnptr-fixture-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('bridges an indirect struct function-pointer call to registered handlers', async () => {
    fs.writeFileSync(
      path.join(dir, 'commands.c'),
      `struct command_ops {
  void (*run)(int);
};

void cmd_add(int argc) {
  (void)argc;
}

void cmd_sub(int argc) {
  (void)argc;
}

static struct command_ops commands[] = {
  { cmd_add },
  { cmd_sub },
};

void run_builtin(struct command_ops *ops, int argc) {
  ops->run(argc);
}
`
    );

    const ow = await OmniWeave.init(dir, { silent: true });
    await ow.indexAll();

    const fns = ow.getNodesByKind('function');
    const runBuiltin = fns.find((n) => n.name === 'run_builtin');
    const cmdAdd = fns.find((n) => n.name === 'cmd_add');
    const cmdSub = fns.find((n) => n.name === 'cmd_sub');
    expect(runBuiltin).toBeDefined();
    expect(cmdAdd).toBeDefined();
    expect(cmdSub).toBeDefined();

    const edges = ow.getOutgoingEdges(runBuiltin!.id);
    for (const target of [cmdAdd!, cmdSub!]) {
      const edge = edges.find(
        (e) =>
          e.target === target.id &&
          e.kind === 'calls' &&
          e.provenance === 'heuristic' &&
          (e.metadata as { synthesizedBy?: string } | undefined)?.synthesizedBy === 'fn-pointer-dispatch'
      );
      expect(edge).toBeDefined();
      expect((edge!.metadata as { confidence?: number }).confidence).toBe(0.8);
      expect((edge!.metadata as { via?: string }).via).toBe('command_ops.run');
    }
  });

  it('does not merge same-named structs from unrelated translation units', async () => {
    fs.writeFileSync(
      path.join(dir, 'commands.c'),
      `struct ops {
  void (*run)(int);
};

void cmd_add(int argc) {
  (void)argc;
}

static struct ops commands[] = {
  { cmd_add },
};
`
    );
    fs.writeFileSync(
      path.join(dir, 'unrelated.c'),
      `struct ops {
  void (*run)(int);
};

void unrelated_dispatch(struct ops *ops, int argc) {
  ops->run(argc);
}
`
    );

    const ow = await OmniWeave.init(dir, { silent: true });
    await ow.indexAll();

    const fns = ow.getNodesByKind('function');
    const unrelated = fns.find((n) => n.name === 'unrelated_dispatch');
    const cmdAdd = fns.find((n) => n.name === 'cmd_add');
    expect(unrelated).toBeDefined();
    expect(cmdAdd).toBeDefined();

    const edges = ow.getOutgoingEdges(unrelated!.id);
    expect(edges.some((e) => e.target === cmdAdd!.id && e.kind === 'calls')).toBe(false);
  });

  it('does not synthesize dispatch edges from string literals', async () => {
    fs.writeFileSync(
      path.join(dir, 'commands.c'),
      `struct command_ops {
  void (*run)(int);
};

void cmd_add(int argc) {
  (void)argc;
}

static struct command_ops commands[] = {
  { cmd_add },
};

void log_builtin(void) {
  const char *trace = "ops->run(argc)";
  (void)trace;
}
`
    );

    const ow = await OmniWeave.init(dir, { silent: true });
    await ow.indexAll();

    const fns = ow.getNodesByKind('function');
    const logBuiltin = fns.find((n) => n.name === 'log_builtin');
    const cmdAdd = fns.find((n) => n.name === 'cmd_add');
    expect(logBuiltin).toBeDefined();
    expect(cmdAdd).toBeDefined();

    const edges = ow.getOutgoingEdges(logBuiltin!.id);
    expect(edges.some((e) => e.target === cmdAdd!.id && e.kind === 'calls')).toBe(false);
  });

  it('uses explicit include evidence for shared header structs', async () => {
    fs.writeFileSync(
      path.join(dir, 'ops.h'),
      `struct ops {
  void (*run)(int);
};
`
    );
    fs.writeFileSync(
      path.join(dir, 'commands.c'),
      `#include "ops.h"

void cmd_add(int argc) {
  (void)argc;
}

static struct ops commands[] = {
  { cmd_add },
};
`
    );
    fs.writeFileSync(
      path.join(dir, 'runner.c'),
      `#include "ops.h"

void run_registered(struct ops *ops, int argc) {
  ops->run(argc);
}
`
    );

    const ow = await OmniWeave.init(dir, { silent: true });
    await ow.indexAll();

    const fns = ow.getNodesByKind('function');
    const runRegistered = fns.find((n) => n.name === 'run_registered');
    const cmdAdd = fns.find((n) => n.name === 'cmd_add');
    expect(runRegistered).toBeDefined();
    expect(cmdAdd).toBeDefined();

    const edge = ow.getOutgoingEdges(runRegistered!.id).find(
      (e) =>
        e.target === cmdAdd!.id &&
        e.kind === 'calls' &&
        (e.metadata as { synthesizedBy?: string } | undefined)?.synthesizedBy === 'fn-pointer-dispatch'
    );
    expect(edge).toBeDefined();
    expect((edge!.metadata as { via?: string }).via).toBe('ops.run');
  });

  it('registers direct function assignments to function-pointer fields', async () => {
    fs.writeFileSync(
      path.join(dir, 'hooks.c'),
      `struct hook_ops {
  void (*run)(int);
};

void cmd_add(int argc) {
  (void)argc;
}

void install_hook(struct hook_ops *ops) {
  ops->run = cmd_add;
}

void run_hook(struct hook_ops *ops, int argc) {
  ops->run(argc);
}
`
    );

    const ow = await OmniWeave.init(dir, { silent: true });
    await ow.indexAll();

    const fns = ow.getNodesByKind('function');
    const runHook = fns.find((n) => n.name === 'run_hook');
    const cmdAdd = fns.find((n) => n.name === 'cmd_add');
    expect(runHook).toBeDefined();
    expect(cmdAdd).toBeDefined();

    const edge = ow.getOutgoingEdges(runHook!.id).find(
      (e) =>
        e.target === cmdAdd!.id &&
        e.kind === 'calls' &&
        (e.metadata as { synthesizedBy?: string } | undefined)?.synthesizedBy === 'fn-pointer-dispatch'
    );
    expect(edge).toBeDefined();
    expect((edge!.metadata as { via?: string }).via).toBe('hook_ops.run');
    expect((edge!.metadata as { registeredAt?: string }).registeredAt).toContain('hooks.c:10');
  });
});
