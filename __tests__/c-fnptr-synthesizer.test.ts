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
});
