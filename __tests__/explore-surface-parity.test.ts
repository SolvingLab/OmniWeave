import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import OmniWeave from '../src/index';

const BIN = path.resolve(__dirname, '../dist/bin/omniweave.js');
const CLIENT_INFO = { name: 'surface-parity-test', version: '0.0.0' };

function spawnServer(cwd: string): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [BIN, 'serve', '--mcp', '--no-watch'], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OMNIWEAVE_NO_DAEMON: '1',
      OMNIWEAVE_NO_WATCH: '1',
    },
  }) as ChildProcessWithoutNullStreams;
}

function collectMessages(child: ChildProcessWithoutNullStreams): Array<Record<string, any>> {
  const messages: Array<Record<string, any>> = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try { messages.push(JSON.parse(line)); } catch { /* ignore stderr-style noise on stdout */ }
    }
  });
  return messages;
}

function send(child: ChildProcessWithoutNullStreams, message: object): void {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
}

function waitForMessage(
  messages: ReadonlyArray<Record<string, any>>,
  predicate: (message: Record<string, any>) => boolean,
  timeoutMs = 8000,
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = messages.find(predicate);
      if (hit) return resolve(hit);
      if (Date.now() - started > timeoutMs) {
        return reject(new Error(`Timed out waiting for MCP message. Seen: ${JSON.stringify(messages)}`));
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

async function runMcpExplore(projectRoot: string, args: Record<string, unknown>): Promise<string> {
  const child = spawnServer(projectRoot);
  const messages = collectMessages(child);
  try {
    send(child, {
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: CLIENT_INFO,
        rootUri: `file://${projectRoot}`,
      },
    });
    await waitForMessage(messages, (message) => message.id === 0 && !!message.result);
    send(child, { method: 'notifications/initialized' });
    send(child, {
      id: 1,
      method: 'tools/call',
      params: { name: 'omniweave_explore', arguments: args },
    });
    const response = await waitForMessage(messages, (message) => message.id === 1);
    expect(response.error).toBeUndefined();
    return response.result.content[0].text as string;
  } finally {
    if (!child.killed) child.kill('SIGKILL');
  }
}

function runCliExplore(projectRoot: string, query: string, maxFiles?: number): string {
  const args = [BIN, 'explore', query, '--path', projectRoot];
  if (maxFiles != null) args.push('--max-files', String(maxFiles));
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: 'utf-8',
    env: {
      ...process.env,
      OMNIWEAVE_NO_DAEMON: '1',
      OMNIWEAVE_NO_WATCH: '1',
    },
  });
  expect(result.status).toBe(0);
  return result.stdout;
}

describe('explore surface parity', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-explore-parity-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('keeps empty-index recovery shared while preserving surface-specific next steps', async () => {
    const cg = OmniWeave.initSync(projectRoot);
    cg.destroy();

    const mcpText = await runMcpExplore(projectRoot, { query: 'anything' });
    const cliText = runCliExplore(projectRoot, 'anything');

    for (const text of [mcpText, cliText]) {
      expect(text).toContain('No relevant code found for "anything"');
      expect(text).toContain('index is initialized but contains 0 files');
      expect(text).toContain('empty index state, not a tool failure');
    }
    expect(mcpText).toContain('Refresh the index after source files are present');
    expect(mcpText).not.toContain('omniweave sync');
    expect(mcpText).not.toContain('omniweave_explore');
    expect(cliText).toContain('omniweave sync');
    expect(cliText).not.toContain('omniweave_explore');
  }, 20000);

  it('returns the same source envelope for a tiny indexed repo', async () => {
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'tiny.ts'),
      [
        'export function tinyExploreNeedle(): string {',
        "  return 'needle';",
        '}',
        '',
      ].join('\n'),
    );
    const cg = OmniWeave.initSync(projectRoot);
    await cg.indexAll();
    cg.destroy();

    const mcpText = await runMcpExplore(projectRoot, { query: 'src/tiny.ts', maxFiles: 1 });
    const cliText = runCliExplore(projectRoot, 'src/tiny.ts', 1);

    for (const text of [mcpText, cliText]) {
      expect(text).toContain('## Exploration: src/tiny.ts');
      expect(text).toContain('Candidate graph:');
      expect(text).toContain('Source shown below covers 1 file');
      expect(text).toContain('### Source Code');
      expect(text).toContain('#### src/tiny.ts');
      expect(text).toContain('1\texport function tinyExploreNeedle');
      expect(text).not.toContain('No relevant code found');
      expect(text).not.toContain('output truncated to budget');
    }
    expect(cliText.trim()).toBe(mcpText.trim());
  }, 20000);
});
