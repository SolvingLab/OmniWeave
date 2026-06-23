import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import OmniWeave from '../src/index';

const BIN = path.resolve(__dirname, '../dist/bin/omniweave.js');
const CLIENT_INFO = { name: 'surface-parity-test', version: '0.0.0' };

function writeProjectFile(projectRoot: string, relativePath: string, contents: string): void {
  const fullPath = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

async function indexProject(projectRoot: string): Promise<void> {
  const cg = OmniWeave.initSync(projectRoot, {
    config: { include: ['**/*.ts', '**/*.py'], exclude: [] },
  });
  try {
    await cg.indexAll();
  } finally {
    cg.destroy();
  }
}

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

async function runMcpExploreWithHook(
  projectRoot: string,
  args: Record<string, unknown>,
  beforeCall?: () => void | Promise<void>,
): Promise<string> {
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
    if (beforeCall) {
      send(child, { id: 99, method: 'tools/list' });
      await waitForMessage(messages, (message) => message.id === 99 && !!message.result);
      await beforeCall();
    }
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

async function runMcpExplore(projectRoot: string, args: Record<string, unknown>): Promise<string> {
  return runMcpExploreWithHook(projectRoot, args);
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
    writeProjectFile(
      projectRoot,
      'src/tiny.ts',
      [
        'export function tinyExploreNeedle(): string {',
        "  return 'needle';",
        '}',
        '',
      ].join('\n'),
    );
    await indexProject(projectRoot);

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

  it('keeps stale new-file recovery trustworthy across MCP and CLI', async () => {
    writeProjectFile(
      projectRoot,
      'src/indexed.ts',
      [
        'export function indexedStableAnchor(): string {',
        "  return 'indexed';",
        '}',
        '',
      ].join('\n'),
    );
    const cg = OmniWeave.initSync(projectRoot, {
      config: { include: ['**/*.ts', '**/*.py'], exclude: [] },
    });
    let mcpText = '';
    let cliText = '';
    try {
      await cg.indexAll();
      writeProjectFile(
        projectRoot,
        'src/mcp/brand-new.ts',
        [
          'export function brandNewCliFeature(): string {',
          "  return 'new';",
          '}',
          '',
        ].join('\n'),
      );

      cliText = runCliExplore(projectRoot, 'brandNewCliFeature', 3);
      mcpText = await runMcpExplore(projectRoot, { query: 'brandNewCliFeature', maxFiles: 3 });
    } finally {
      cg.destroy();
    }

    // The MCP server intentionally gates the first tool call on catch-up sync,
    // so it serves current source instead of a stale empty result.
    expect(mcpText.startsWith('⚠️')).toBe(false);
    expect(mcpText).toContain('#### src/mcp/brand-new.ts');
    expect(mcpText).toContain('brandNewCliFeature');
    expect(mcpText).not.toContain('No relevant code found');
    expect(mcpText).not.toContain('empty explore result may be stale');

    // The CLI is a one-shot read of the existing index, so it must make the
    // stale boundary explicit instead of pretending the empty result is complete.
    expect(cliText.startsWith('⚠️')).toBe(true);
    expect(cliText).toContain('empty explore result may be stale');
    expect(cliText).toContain('src/mcp/brand-new.ts (added)');
    expect(cliText).toContain('use normal file tools for that path');
    expect(cliText).toContain('No relevant code found for "brandNewCliFeature"');
    expect(cliText).not.toContain('elsewhere in this project changed since the last index');
    expect(cliText).toContain('run `omniweave sync`');
    expect(cliText).not.toContain('from a shell run');
    expect(cliText).not.toContain('omniweave_explore');
    expect(cliText).not.toContain('omniweave_node');
  }, 30000);

  it('keeps snapshot suppression and overload ambiguity aligned across surfaces', async () => {
    writeProjectFile(
      projectRoot,
      'src/mcp/tools.ts',
      [
        'export function buildExploreOutput(): string {',
        "  return 'ranking budget truncation call path edge significance';",
        '}',
        '',
      ].join('\n'),
    );
    writeProjectFile(
      projectRoot,
      'research/2026-06-23-codegraph-ecosystem/repos/codegraph/src/mcp/tools.ts',
      [
        'export function buildExploreOutput(): string {',
        "  return 'external snapshot ranking budget truncation call path';",
        '}',
        '',
      ].join('\n'),
    );
    for (const name of ['alpha', 'bravo', 'charlie', 'delta', 'echo']) {
      writeProjectFile(
        projectRoot,
        `src/overloads/${name}.ts`,
        [
          'export function reconcile(): string {',
          `  return '${name}';`,
          '}',
          '',
        ].join('\n'),
      );
    }
    await indexProject(projectRoot);

    const mcpSnapshotText = await runMcpExplore(projectRoot, {
      query: 'buildExploreOutput ranking budget truncation',
      maxFiles: 5,
    });
    const cliSnapshotText = runCliExplore(projectRoot, 'buildExploreOutput ranking budget truncation', 5);

    for (const text of [mcpSnapshotText, cliSnapshotText]) {
      expect(text).toContain('#### src/mcp/tools.ts');
      expect(text).toContain('buildExploreOutput');
      expect(text).not.toContain(
        'research/2026-06-23-codegraph-ecosystem/repos/codegraph/src/mcp/tools.ts',
      );
    }

    const mcpAmbiguousText = await runMcpExplore(projectRoot, { query: 'reconcile', maxFiles: 5 });
    const cliAmbiguousText = runCliExplore(projectRoot, 'reconcile', 5);

    for (const text of [mcpAmbiguousText, cliAmbiguousText]) {
      expect(text).toContain('### Ambiguous named symbols');
      expect(text).toContain('`reconcile` matched 5 callable definitions');
      expect(text).toContain('do not treat that subset as the full overload set');
      expect(text).toContain('src/overloads/');
    }
    expect(mcpAmbiguousText).toContain('key: `omniweave_node symbol="reconcile" file="src/overloads/');
    expect(cliAmbiguousText).toContain('cmd: `omniweave node "reconcile" --file "src/overloads/');
    expect(cliAmbiguousText).not.toContain('omniweave_node');
    expect(cliAmbiguousText).not.toContain('omniweave_explore');
  }, 30000);

  it('keeps large-repo not-shown follow-ups free of research snapshots across surfaces', async () => {
    writeProjectFile(
      projectRoot,
      'src/scip/importer.ts',
      [
        'export interface ImportScipResult {',
        "  provenance: 'scip';",
        '  source: string;',
        '}',
        '',
        'export function importScipIndex(indexPath: string): ImportScipResult {',
        "  return { provenance: 'scip', source: indexPath.endsWith('index.scip') ? 'index.scip' : indexPath };",
        '}',
        '',
      ].join('\n'),
    );
    writeProjectFile(
      projectRoot,
      'src/scip/protobuf.ts',
      [
        'export interface ScipIndex {',
        '  documents: string[];',
        '}',
        '',
        'export function decodeScipIndex(bytes: Uint8Array): ScipIndex {',
        '  return { documents: [String(bytes.length)] };',
        '}',
        '',
      ].join('\n'),
    );
    writeProjectFile(
      projectRoot,
      'research/2026-06-23-codegraph-ecosystem/repos/cgc/src/tools/scip.ts',
      [
        'export class ScipIndexParser {',
        '  parse(): string {',
        "    return 'external scip index parser';",
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    for (let i = 0; i < 505; i++) {
      writeProjectFile(projectRoot, `src/filler/file-${i}.ts`, `export function filler${i}(): number { return ${i}; }\n`);
    }
    await indexProject(projectRoot);

    const query = 'scip import index.scip provenance';
    const mcpText = await runMcpExplore(projectRoot, { query, maxFiles: 1 });
    const cliText = runCliExplore(projectRoot, query, 1);

    for (const text of [mcpText, cliText]) {
      expect(text).toContain('Candidate graph:');
      expect(text).toContain('Source shown below covers 1 file');
      expect(text).toContain('#### src/scip/importer.ts');
      expect(text).toContain('importScipIndex');
      expect(text).toContain('### Not shown above — explore these names for their source');
      expect(text).toContain('src/scip/protobuf.ts');
      expect(text).not.toContain('research/2026-06-23-codegraph-ecosystem/repos/cgc/');
    }
  }, 40000);

  it('keeps hard-ceiling truncation aligned across MCP and CLI', async () => {
    for (let i = 0; i < 505; i++) {
      writeProjectFile(projectRoot, `noise/noise${i}.ts`, `export const noise${i} = ${i};\n`);
    }
    for (let fileIndex = 0; fileIndex < 8; fileIndex++) {
      const body: string[] = [`export function targetBudget${fileIndex}(): string {`];
      body.push('  const values = [');
      for (let line = 0; line < 240; line++) {
        body.push(`    "targetBudget${fileIndex}-payload-${line.toString().padStart(3, '0')}-abcdefghijklmnopqrstuvwxyz",`);
      }
      body.push('  ];');
      body.push("  return values.join('\\n');");
      body.push('}');
      writeProjectFile(projectRoot, `src/target${fileIndex}.ts`, body.join('\n'));
    }
    await indexProject(projectRoot);

    const query = Array.from({ length: 8 }, (_, i) => `targetBudget${i}`).join(' ');
    const mcpText = await runMcpExplore(projectRoot, { query, maxFiles: 8 });
    const cliText = runCliExplore(projectRoot, query, 8);

    for (const text of [mcpText, cliText]) {
      expect(text).toContain('output truncated to budget');
      expect(text.length).toBeLessThanOrEqual(25000);
      expect(text).toContain('Treat only complete source blocks shown above as already Read');
      expect(text).toContain('#### src/target');
      expect(text).toContain('```typescript');
      expect((text.match(/```/g) ?? []).length % 2).toBe(0);
    }
    expect(mcpText).toContain('run another omniweave_explore with the specific names');
    expect(cliText).toContain('omniweave explore "<names>"');
    expect(cliText).not.toContain('omniweave_explore');
    expect(cliText).not.toContain('omniweave_node');
  }, 40000);

  it('keeps stale-wrapped hard-ceiling output aligned across MCP and CLI', async () => {
    for (let i = 0; i < 505; i++) {
      writeProjectFile(projectRoot, `noise/noise${i}.ts`, `export const noise${i} = ${i};\n`);
    }
    for (let fileIndex = 0; fileIndex < 8; fileIndex++) {
      const body: string[] = [`export function staleBudget${fileIndex}(): string {`];
      body.push('  const values = [');
      for (let line = 0; line < 240; line++) {
        body.push(`    "staleBudget${fileIndex}-payload-${line.toString().padStart(3, '0')}-abcdefghijklmnopqrstuvwxyz",`);
      }
      body.push('  ];');
      body.push("  return values.join('\\n');");
      body.push('}');
      writeProjectFile(projectRoot, `src/stale-target${fileIndex}.ts`, body.join('\n'));
    }
    await indexProject(projectRoot);

    const query = Array.from({ length: 8 }, (_, i) => `staleBudget${i}`).join(' ');
    const targetPath = path.join(projectRoot, 'src', 'stale-target0.ts');
    const original = fs.readFileSync(targetPath, 'utf-8');
    const markModified = () => fs.writeFileSync(targetPath, `${original}\n// stale edit\n`);
    const mcpText = await runMcpExploreWithHook(projectRoot, { query, maxFiles: 8 }, markModified);
    const cliText = runCliExplore(projectRoot, query, 8);

    for (const text of [mcpText, cliText]) {
      expect(text.startsWith('⚠️')).toBe(true);
      expect(text).toContain('src/stale-target0.ts (modified)');
      expect(text).toMatch(/output truncated to (?:budget|final inline budget after freshness\/worktree notices)/);
      expect(text.length).toBeLessThanOrEqual(25000);
      expect(text).toContain('Treat only complete source blocks shown above as already Read');
      expect((text.match(/```/g) ?? []).length % 2).toBe(0);
    }
    expect(mcpText).toContain('omniweave_node <path>');
    expect(mcpText).toContain('run another omniweave_explore with the specific names');
    expect(mcpText).not.toContain('omniweave node <path>');
    expect(cliText).toContain('omniweave node <path>');
    expect(cliText).toContain('omniweave explore "<names>"');
    expect(cliText).not.toContain('omniweave_node');
    expect(cliText).not.toContain('omniweave_explore');
  }, 40000);
});
