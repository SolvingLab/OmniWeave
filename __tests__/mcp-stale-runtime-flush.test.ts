import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { MCPEngine } from '../src/mcp/engine';
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcTransport, MessageHandler } from '../src/mcp/transport';
import { waitForWriteFlush } from '../src/mcp/transport';

const REPO = path.resolve(__dirname, '..');

describe('waitForWriteFlush', () => {
  it('waits for the stream write callback before resolving', async () => {
    let callbackFired = false;

    await waitForWriteFlush((finish) => {
      setTimeout(() => {
        callbackFired = true;
        finish();
      }, 5);
    });

    expect(callbackFired).toBe(true);
  });

  it('resolves when the stream write throws', async () => {
    await expect(waitForWriteFlush(() => {
      throw new Error('broken pipe');
    })).resolves.toBeUndefined();
  });
});

describe('MCPSession stale runtime replies', () => {
  afterEach(() => {
    vi.doUnmock('../src/mcp/version');
    vi.resetModules();
  });

  it('flushes the stale-runtime JSON-RPC error before closing the transport', async () => {
    vi.doMock('../src/mcp/version', () => ({
      OmniWeavePackageVersion: '1.0.0',
      runtimeBuildSkew: () => ({ loaded: '1.0.0+oldbuild', current: '1.0.0+newbuild' }),
      runtimeBuildSkewMessage: (skew: { loaded: string; current: string }) =>
        `OmniWeave MCP runtime is stale: running ${skew.loaded}, but current disk build is ${skew.current}. Restart the MCP server before trusting tool output.`,
    }));

    const { MCPSession } = await import('../src/mcp/session');
    const transport = new FakeTransport();
    let ownerMessage = '';
    const session = new MCPSession(transport, {} as MCPEngine, {
      onStaleRuntime: (message) => {
        ownerMessage = message;
        transport.events.push('owner-stale');
      },
    });
    session.start();

    await transport.deliver({ jsonrpc: '2.0', id: 7, method: 'tools/list' });

    expect(transport.events).toEqual(['flush-error:7', 'stop', 'owner-stale']);
    expect(transport.errorMessage).toContain('OmniWeave MCP runtime is stale');
    expect(ownerMessage).toBe(transport.errorMessage);
  });
});

describe('built MCP stale runtime process recovery', () => {
  let tempRoot = '';
  let projectRoot = '';
  let child: ChildProcessWithoutNullStreams | null = null;

  afterEach(() => {
    if (child && !child.killed) {
      try { child.kill('SIGKILL'); } catch { /* gone */ }
      child = null;
    }
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = '';
      projectRoot = '';
    }
  });

  it('flushes the stale-runtime error and exits the direct stdio server', async () => {
    const sourceDist = path.join(REPO, 'dist');
    const sourceBin = path.join(sourceDist, 'bin', 'omniweave.js');
    if (!fs.existsSync(sourceBin)) {
      expect.soft(fs.existsSync(sourceBin), 'run `npm run build` before this test').toBe(true);
      return;
    }

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-stale-runtime-'));
    projectRoot = path.join(tempRoot, 'project');
    fs.mkdirSync(projectRoot);
    fs.cpSync(sourceDist, path.join(tempRoot, 'dist'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'package.json'), path.join(tempRoot, 'package.json'));
    fs.symlinkSync(
      path.join(REPO, 'node_modules'),
      path.join(tempRoot, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const bin = path.join(tempRoot, 'dist', 'bin', 'omniweave.js');
    child = spawn(process.execPath, [bin, 'serve', '--mcp'], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, OMNIWEAVE_NO_DAEMON: '1' },
    }) as ChildProcessWithoutNullStreams;
    child.on('error', () => { /* ignore */ });
    child.stdin.on('error', () => { /* ignore */ });

    const stdout = collectJsonRpc(child);
    sendJson(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.0' },
        rootUri: `file://${projectRoot}`,
      },
    });
    const init = await waitForResponse(stdout, 1, 5000);
    expect(init.result.serverInfo.name).toBe('omniweave');

    fs.writeFileSync(path.join(tempRoot, 'dist', '.build-id'), 'ffffffffffff\n');
    sendJson(child, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const stale = await waitForResponse(stdout, 2, 5000);
    expect(stale.error.message).toContain('OmniWeave MCP runtime is stale');
    expect(stale.error.message).toContain('ffffffffffff');

    await expect(waitForExit(child, 5000)).resolves.toBe(true);
    child = null;
  }, 20000);
});

class FakeTransport implements JsonRpcTransport {
  events: string[] = [];
  errorMessage = '';
  private handler: MessageHandler | null = null;

  start(handler: MessageHandler): void {
    this.handler = handler;
  }

  stop(): void {
    this.events.push('stop');
  }

  send(): void { /* not used */ }
  notify(): void { /* not used */ }
  request(): Promise<unknown> { return Promise.resolve({}); }
  sendResult(): void { /* not used */ }
  sendError(): void { /* not used */ }

  async sendErrorAndFlush(id: string | number | null, _code: number, message: string): Promise<void> {
    this.events.push(`flush-error:${String(id)}`);
    this.errorMessage = message;
  }

  async deliver(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    if (!this.handler) throw new Error('transport not started');
    await this.handler(message);
  }
}

function sendJson(child: ChildProcessWithoutNullStreams, msg: unknown): void {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

function collectJsonRpc(child: ChildProcessWithoutNullStreams): unknown[] {
  const messages: unknown[] = [];
  let buffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try { messages.push(JSON.parse(line)); } catch { /* ignore non-JSON */ }
    }
  });
  child.stderr.on('data', () => { /* drain stderr */ });
  return messages;
}

function waitForResponse(messages: unknown[], id: number, timeoutMs: number): Promise<any> {
  return waitFor(
    () => messages.find((msg) =>
      typeof msg === 'object' &&
      msg !== null &&
      (msg as { id?: unknown }).id === id
    ) as any,
    timeoutMs,
  );
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for MCP process exit`));
    }, timeoutMs);
    child.once('exit', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function waitFor<T>(
  predicate: () => T | undefined | null | false,
  timeoutMs: number,
  pollMs = 25,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      let value: T | undefined | null | false;
      try { value = predicate(); } catch (err) { reject(err); return; }
      if (value) { resolve(value); return; }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out after ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, pollMs);
    };
    tick();
  });
}
