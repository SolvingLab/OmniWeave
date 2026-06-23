/**
 * Unindexed-workspace session policy tests.
 *
 * An MCP session attached to a workspace with no .omniweave/ must go quiet
 * rather than fail loudly: `initialize` returns the short "inactive"
 * instructions variant (not the full playbook), `tools/list` returns an
 * EMPTY list, and a tool call that still arrives (cross-project
 * `projectPath`, or a host that skips tools/list) answers with a
 * SUCCESS-shaped guidance message — never `isError: true`. One or two early
 * isError responses teach an agent to abandon omniweave for the whole
 * session; that observed failure mode is what this suite guards.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OmniWeave } from '../src';
import { ToolHandler } from '../src/mcp/tools';

const BIN = path.resolve(__dirname, '../dist/bin/omniweave.js');

function spawnServer(cwd: string): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [BIN, 'serve', '--mcp'], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    // Direct (in-process) mode — the unindexed path never has a daemon
    // anyway (the daemon socket lives in .omniweave/), and this keeps the
    // suite from leaking a detached daemon in the indexed test.
    // OMNIWEAVE_WASM_RELAUNCHED skips the --liftoff-only re-exec: without
    // it the server runs as a GRANDCHILD that survives child.kill() on
    // Windows and holds the temp cwd/SQLite handles, failing teardown with
    // EPERM no matter how long rmSync retries (the class documented for
    // the mcp-initialize/mcp-roots suites).
    env: { ...process.env, OMNIWEAVE_NO_DAEMON: '1', OMNIWEAVE_WASM_RELAUNCHED: '1' },
  }) as ChildProcessWithoutNullStreams;
}

/** Send a JSON-RPC request and resolve with the response matching its id. */
function request(
  child: ChildProcessWithoutNullStreams,
  msg: { id: number; method: string; params?: unknown },
  timeoutMs = 15000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      child.stdout.off('data', onData);
      reject(new Error(`timeout waiting for response id=${msg.id}`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed.id === msg.id) {
            clearTimeout(timer);
            child.stdout.off('data', onData);
            resolve(parsed);
            return;
          }
        } catch {
          // non-JSON noise on stdout — ignore
        }
      }
    };
    child.stdout.on('data', onData);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  });
}

function initializeParams(projectPath: string) {
  return {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.0' },
    rootUri: `file://${projectPath}`,
  };
}

describe('Unindexed-workspace session policy', () => {
  let tempDir: string;
  let child: ChildProcessWithoutNullStreams | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-unindexed-'));
  });

  afterEach(async () => {
    if (child) {
      // Wait for the child to actually exit before removing its cwd — on
      // Windows a just-killed process briefly holds the directory/SQLite
      // handles, and an immediate rmSync fails the teardown with EPERM
      // (the documented file-locking class that fails the sibling
      // mcp-initialize/mcp-roots suites). kill + await exit + retried
      // removal keeps this suite green on Windows.
      const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
      child = null;
    }
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it('initialize returns the short "inactive" instructions, not the playbook', async () => {
    fs.writeFileSync(path.join(tempDir, 'index.ts'), 'export const x = 1;\n');
    child = spawnServer(tempDir);

    const res = await request(child, { id: 0, method: 'initialize', params: initializeParams(tempDir) });
    const instructions = (res.result as { instructions: string }).instructions;

    expect(instructions).toMatch(/inactive/i);
    expect(instructions).toMatch(/omniweave init/);
    // The full playbook must NOT be sent into a session where every call fails
    expect(instructions).not.toMatch(/Tool selection by intent/);
    expect(instructions).not.toMatch(/omniweave_explore/);
  });

  it('tools/list returns an EMPTY list when the workspace has no index', async () => {
    child = spawnServer(tempDir);
    await request(child, { id: 0, method: 'initialize', params: initializeParams(tempDir) });

    const res = await request(child, { id: 1, method: 'tools/list' });
    expect((res.result as { tools: unknown[] }).tools).toEqual([]);
  });

  it('an INDEXED workspace still gets the full playbook and all tools', async () => {
    fs.writeFileSync(path.join(tempDir, 'index.ts'), 'export function hello(): string { return "hi"; }\n');
    const cg = await OmniWeave.init(tempDir, { index: true });
    cg.close();

    child = spawnServer(tempDir);
    const init = await request(child, { id: 0, method: 'initialize', params: initializeParams(tempDir) });
    const instructions = (init.result as { instructions: string }).instructions;
    expect(instructions).toMatch(/Tool selection by intent/);
    expect(instructions).not.toMatch(/inactive/i);

    const list = await request(child, { id: 1, method: 'tools/list' });
    const tools = (list.result as { tools: Array<{ name: string }> }).tools;
    // A 1-file project triggers the pre-existing tiny-repo tool gating (a
    // reduced core set) — the contract under test is "indexed → tools are
    // PRESENT", in contrast to the unindexed empty list above.
    expect(tools.length).toBeGreaterThanOrEqual(3);
    expect(tools.map((t) => t.name)).toContain('omniweave_explore');
  });
});

describe('No-error policy on expected conditions', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-noerror-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('cross-project query to an unindexed path is SUCCESS-shaped guidance, not isError', async () => {
    const res = await new ToolHandler(null).execute('omniweave_search', {
      query: 'anything',
      projectPath: tempDir,
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.text).toMatch(/isn't indexed/);
    expect(res.content[0]!.text).toMatch(/omniweave init/);
    expect(res.content[0]!.text).toMatch(/built-in tools/);
  });

  it('no-default-project (working-directory detection miss) is SUCCESS-shaped guidance', async () => {
    const res = await new ToolHandler(null).execute('omniweave_search', { query: 'anything' });

    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.text).toMatch(/No OmniWeave project is loaded/);
    expect(res.content[0]!.text).toMatch(/projectPath/);
  });

  it('empty initialized index is SUCCESS-shaped guidance, not a generic miss', async () => {
    const cg = OmniWeave.initSync(tempDir, {
      config: { include: ['**/*.ts'], exclude: [] },
    });
    try {
      const res = await new ToolHandler(cg).execute('omniweave_explore', { query: 'anything' });

      expect(res.isError).toBeUndefined();
      expect(res.content[0]!.text).toMatch(/index is initialized but contains 0 files/);
      expect(res.content[0]!.text).toMatch(/empty index state, not a tool failure/);
      expect(res.content[0]!.text).toMatch(/Continue with normal file tools/);
      expect(res.content[0]!.text).toMatch(/Refresh the index after source files are present/);
      expect(res.content[0]!.text).not.toMatch(/omniweave sync/);
    } finally {
      cg.close();
    }
  });

  it('MCP empty retrieval guidance keeps MCP tool names', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'index.ts'),
      `export function knownThing(): string {
  return 'known';
}
`
    );
    const cg = OmniWeave.initSync(tempDir, {
      config: { include: ['**/*.ts'], exclude: [] },
    });
    try {
      await cg.indexAll();

      const res = await new ToolHandler(cg).execute('omniweave_explore', { query: 'xqzvbnmwrtypsdfghjkl' });
      const text = res.content[0]!.text;

      expect(res.isError).toBeUndefined();
      expect(text).toContain('No relevant code found for "xqzvbnmwrtypsdfghjkl"');
      expect(text).toContain('omniweave_search <name>');
      expect(text).toContain('omniweave_node <path>');
      expect(text).toContain('omniweave_explore');
      expect(text).not.toContain('omniweave query <name>');
      expect(text).not.toContain('omniweave node <path>');
    } finally {
      cg.close();
    }
  });

  it.runIf(process.platform !== 'win32')(
    'sensitive-path refusal stays a hard error (no retry encouragement)',
    async () => {
      const res = await new ToolHandler(null).execute('omniweave_search', {
        query: 'anything',
        projectPath: '/etc',
      });

      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).not.toMatch(/retry the call once/);
    }
  );
});

describe('search kind filter', () => {
  let tempDir: string;
  let cg: OmniWeave;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-kind-'));
    fs.writeFileSync(
      path.join(tempDir, 'types.ts'),
      'export type PaymentMethod = { id: string };\nexport function pay(): void {}\n'
    );
    cg = await OmniWeave.init(tempDir, { index: true });
  });

  afterEach(() => {
    cg.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("kind: 'type' (the advertised enum value) finds type aliases", async () => {
    const res = await new ToolHandler(cg).execute('omniweave_search', {
      query: 'PaymentMethod',
      kind: 'type',
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.text).toMatch(/PaymentMethod/);
    expect(res.content[0]!.text).not.toMatch(/No results found/);
  });
});
