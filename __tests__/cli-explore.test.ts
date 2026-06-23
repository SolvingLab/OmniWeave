/**
 * CLI parity for the primary agent read surface.
 *
 * `omniweave explore` is the non-MCP face of `omniweave_explore`, so agents
 * running through shell-only subagents must get the same recovery behavior and
 * low-signal filtering as MCP clients.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import OmniWeave from '../src/index';
import type { Edge } from '../src/types';

const BIN = path.resolve(__dirname, '../dist/bin/omniweave.js');

interface EdgeInserter {
  queries: {
    insertEdge(edge: Edge): void;
  };
}

function runCli(cwd: string, args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      OMNIWEAVE_NO_DAEMON: '1',
      OMNIWEAVE_NO_WATCH: '1',
    },
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

describe('CLI explore unavailable-index policy', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-cli-noindex-'));
  });

  afterEach(() => {
    if (testDir && fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('returns success-shaped guidance on an unindexed project', () => {
    const result = runCli(testDir, ['explore', 'anything']);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain("OmniWeave isn't available here");
    expect(result.stdout).toContain('not a tool failure');
    expect(result.stdout).toContain('continue with your usual tools');
    expect(result.stdout).toContain('omniweave init');
  });

  it('explains an initialized but empty index as a recoverable empty state', () => {
    const cg = OmniWeave.initSync(testDir, {
      config: { include: ['**/*.ts'], exclude: [] },
    });
    cg.destroy();

    const result = runCli(testDir, ['explore', 'anything']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No relevant code found for "anything"');
    expect(result.stdout).toContain('index is initialized but contains 0 files');
    expect(result.stdout).toContain('empty index state, not a tool failure');
    expect(result.stdout).toContain('Continue with normal file tools');
    expect(result.stdout).toContain('supported and not excluded');
    expect(result.stdout).toContain('omniweave sync');
    expect(result.stdout).not.toContain('omniweave_explore');
  });
});

describe('CLI explore parity', () => {
  let testDir: string;
  let cg: OmniWeave;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-cli-explore-'));

    const firstPartyMcp = path.join(testDir, 'src', 'mcp');
    const firstPartyOther = path.join(testDir, 'src', 'other');
    const overloads = path.join(testDir, 'src', 'overloads');
    const scripts = path.join(testDir, 'scripts');
    const snapshotMcp = path.join(
      testDir,
      'research',
      '2026-06-23-codegraph-ecosystem',
      'repos',
      'codegraph',
      'src',
      'mcp'
    );
    fs.mkdirSync(firstPartyMcp, { recursive: true });
    fs.mkdirSync(firstPartyOther, { recursive: true });
    fs.mkdirSync(overloads, { recursive: true });
    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(snapshotMcp, { recursive: true });

    fs.writeFileSync(
      path.join(firstPartyMcp, 'tools.ts'),
      `export function buildExploreOutput(): string {
  return 'ranking budget truncation call path edge significance';
}
`
    );
    fs.writeFileSync(
      path.join(firstPartyMcp, 'flow.ts'),
      `export interface FlowResult {
  value: string;
}

export type FlowAlias = string;

export function entryPoint(): FlowResult {
  return { value: localStep() + snapshotOnly() + runPythonReport() };
}

export function localStep(): string {
  return 'local';
}

export function runPythonReport(): string {
  return 'report';
}
`
    );
    fs.writeFileSync(
      path.join(firstPartyOther, 'flow.ts'),
      `export function entryPoint(): string {
  return localStep() + otherStep();
}

export function localStep(): string {
  return 'other-local';
}

export function otherStep(): string {
  return 'other-step';
}
`
    );
    for (const name of ['alpha', 'bravo', 'charlie', 'delta', 'echo']) {
      fs.writeFileSync(
        path.join(overloads, `${name}.ts`),
        `export function reconcile(): string {
  return '${name}';
}
`
      );
    }
    fs.writeFileSync(
      path.join(overloads, 'same-file.ts'),
      `export function repeated(): string {
  return 'first';
}

export function repeated(): string {
  return 'second';
}
`
    );
    fs.writeFileSync(
      path.join(snapshotMcp, 'tools.ts'),
      `export function buildExploreOutput(): string {
  return 'external snapshot ranking budget truncation call path';
}
`
    );
    fs.writeFileSync(
      path.join(snapshotMcp, 'noise.ts'),
      `export function snapshotOnly(): string {
  return 'snapshot-only';
}

export function snapshotCaller(): string {
  return localStep();
}
`
    );
    fs.writeFileSync(
      path.join(scripts, 'report.py'),
      `def renderReport():
    return "report"
`
    );

    cg = OmniWeave.initSync(testDir, {
      config: { include: ['**/*.ts', '**/*.py'], exclude: [] },
    });
    await cg.indexAll();

    const runPythonReport = cg.getNodesByName('runPythonReport').find((n) => n.kind === 'function');
    const renderReport = cg.getNodesByName('renderReport').find((n) => n.kind === 'function');
    expect(runPythonReport).toBeTruthy();
    expect(renderReport).toBeTruthy();
    (cg as unknown as EdgeInserter).queries.insertEdge({
      source: runPythonReport!.id,
      target: renderReport!.id,
      kind: 'crossLang',
      line: 12,
      provenance: 'heuristic',
      metadata: {
        synthesizedBy: 'general-crosslang',
        confidence: 0.9,
      },
    });
  });

  afterEach(() => {
    if (cg) cg.destroy();
    if (testDir && fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('returns success-shaped recovery guidance for empty results', () => {
    const result = runCli(testDir, ['explore', 'xqzvbnmwrtypsdfghjkl']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No relevant code found for "xqzvbnmwrtypsdfghjkl"');
    expect(result.stdout).toContain('not a tool failure');
    expect(result.stdout).toContain('omniweave query <name>');
    expect(result.stdout).toContain('omniweave node <path>');
    expect(result.stdout).toContain('omniweave explore "<identifier1 identifier2 ...>"');
    expect(result.stdout).toContain('omniweave sync');
    expect(result.stdout).not.toContain('omniweave_search');
    expect(result.stdout).not.toContain('omniweave_node');
    expect(result.stdout).not.toContain('omniweave_explore');
  });

  it('warns that empty shell explore results may be stale when new files are not indexed yet', () => {
    fs.writeFileSync(
      path.join(testDir, 'src', 'mcp', 'brand-new.ts'),
      `export function brandNewCliFeature(): string {
  return 'new';
}
`
    );

    const result = runCli(testDir, ['explore', 'brandNewCliFeature']);

    expect(result.status).toBe(0);
    expect(result.stdout.startsWith('⚠️')).toBe(true);
    expect(result.stdout).toContain('empty explore result may be stale');
    expect(result.stdout).toContain('src/mcp/brand-new.ts (added)');
    expect(result.stdout).toContain('run `omniweave sync`');
    expect(result.stdout).toContain('use normal file tools for that path');
    expect(result.stdout).toContain('No relevant code found for "brandNewCliFeature"');
    expect(result.stdout).not.toContain('omniweave_node');
    expect(result.stdout).not.toContain('omniweave_explore');
    expect(result.stdout).not.toContain('elsewhere in this project changed since the last index');
  });

  it('keeps external research snapshots out of default source output', () => {
    const result = runCli(testDir, [
      'explore',
      'buildExploreOutput',
      'ranking',
      'budget',
      'truncation',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('src/mcp/tools.ts');
    expect(result.stdout).not.toContain(
      'research/2026-06-23-codegraph-ecosystem/repos/codegraph/src/mcp/tools.ts'
    );
  });

  it('warns when shell explore reads from a worktree changed since the last index', () => {
    fs.writeFileSync(
      path.join(testDir, 'src', 'mcp', 'tools.ts'),
      `export function buildExploreOutput(): string {
  return 'fresh ranking budget truncation call path edge significance';
}
`
    );

    const result = runCli(testDir, ['explore', 'buildExploreOutput', 'ranking']);

    expect(result.status).toBe(0);
    expect(result.stdout.startsWith('⚠️')).toBe(true);
    expect(result.stdout).toContain('index is behind the worktree');
    expect(result.stdout).toContain('src/mcp/tools.ts (modified)');
    expect(result.stdout).toContain('omniweave sync');
    expect(result.stdout).toContain('omniweave node <path>');
    expect(result.stdout).not.toContain('omniweave_node <path>');
    expect(result.stdout).toContain('fresh ranking budget truncation call path edge significance');
  });

  it('keeps CLI max-files parsing aligned with the MCP handler', () => {
    const valid = runCli(testDir, ['explore', 'reconcile', '--max-files', '2']);
    const invalid = runCli(testDir, ['explore', 'reconcile', '--max-files', '2abc']);

    expect(valid.status).toBe(0);
    expect(invalid.status).toBe(0);
    expect(valid.stdout.match(/^#### /gm)?.length ?? 0).toBe(2);
    expect(invalid.stdout.match(/^#### /gm)?.length ?? 0).toBeGreaterThan(2);
  });

  it('warns when shell explore hits a deleted indexed file', () => {
    fs.rmSync(path.join(testDir, 'src', 'mcp', 'tools.ts'));

    const result = runCli(testDir, ['explore', 'buildExploreOutput', 'ranking']);

    expect(result.status).toBe(0);
    expect(result.stdout.startsWith('⚠️')).toBe(true);
    expect(result.stdout).toContain('index is behind the worktree');
    expect(result.stdout).toContain('src/mcp/tools.ts (removed)');
    expect(result.stdout).toContain('indexed but missing on disk');
    expect(result.stdout).toContain('Treat these symbol and relationship hits as stale');
    expect(result.stdout).toContain('omniweave node <path>');
    expect(result.stdout).not.toContain('omniweave_node <path>');
    expect(result.stdout).not.toContain('elsewhere in this project changed since the last index');
  });

  it('surfaces bare-symbol ambiguity through the shell command', () => {
    const result = runCli(testDir, ['explore', 'reconcile']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('### Ambiguous named symbols');
    expect(result.stdout).toContain('`reconcile` matched 5 callable definitions');
    expect(result.stdout).toContain('cmd: `omniweave node "reconcile" --file "src/overloads/');
    expect(result.stdout).toContain('omniweave node ... --file ... --line');
    expect(result.stdout).not.toContain('omniweave_node');
    expect(result.stdout).not.toContain('omniweave_explore');
  });

  it('prints continuation keys for CLI query results', () => {
    const result = runCli(testDir, ['query', 'buildExploreOutput']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Search Results for "buildExploreOutput"');
    expect(result.stdout).toContain(
      'cmd: omniweave node "buildExploreOutput" --file "src/mcp/tools.ts" --line 1'
    );
    expect(result.stdout).not.toContain('omniweave_node');
  });

  it('uses MCP-style bounded integer parsing for CLI query limits', () => {
    const capped = runCli(testDir, ['query', 'reconcile', '--limit', '2']);
    const invalid = runCli(testDir, ['query', 'reconcile', '--limit', '2abc']);

    expect(capped.status).toBe(0);
    expect(invalid.status).toBe(0);
    expect(capped.stdout.match(/cmd: omniweave node/g)?.length ?? 0).toBe(2);
    expect(invalid.stdout.match(/cmd: omniweave node/g)?.length ?? 0).toBeGreaterThan(2);
    expect(capped.stdout).not.toContain('omniweave_node');
    expect(invalid.stdout).not.toContain('omniweave_node');
  });

  it('maps CLI query kind=type the same way as MCP search', () => {
    const result = runCli(testDir, ['query', 'FlowAlias', '--kind', 'type']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Search Results for "FlowAlias"');
    expect(result.stdout).toContain('type_alias');
    expect(result.stdout).toContain('cmd: omniweave node "FlowAlias" --file "src/mcp/flow.ts"');
    expect(result.stdout).not.toContain('omniweave_node');
  });

  it('falls back instead of parseInt-truncating invalid CLI node limits', () => {
    const valid = runCli(testDir, ['node', 'src/mcp/flow.ts', '--limit', '2']);
    const invalid = runCli(testDir, ['node', 'src/mcp/flow.ts', '--limit', '2abc']);

    expect(valid.status).toBe(0);
    expect(invalid.status).toBe(0);
    expect(valid.stdout.match(/^\d+\t/gm)?.length ?? 0).toBe(2);
    expect(invalid.stdout.match(/^\d+\t/gm)?.length ?? 0).toBeGreaterThan(2);
  });

  it('passes CLI node line hints through to MCP-style overload disambiguation', () => {
    const ambiguous = runCli(testDir, ['node', 'repeated', '--file', 'src/overloads/same-file.ts']);
    const pinned = runCli(testDir, ['node', 'repeated', '--file', 'src/overloads/same-file.ts', '--line', '5']);

    expect(ambiguous.status).toBe(0);
    expect(pinned.status).toBe(0);
    expect(ambiguous.stdout).toContain('2 definitions named "repeated"');
    expect(pinned.stdout).not.toContain('2 definitions named "repeated"');
    expect(pinned.stdout).toContain("return 'second';");
    expect(pinned.stdout).not.toContain("return 'first';");
  });

  it('prints shell continuations from CLI node symbol output', () => {
    const result = runCli(testDir, ['node', 'buildExploreOutput', '--file', 'src/mcp/tools.ts', '--line', '1']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('**Command:** `omniweave node "buildExploreOutput" --file "src/mcp/tools.ts" --line 1`');
    expect(result.stdout).not.toContain('omniweave_node');
  });

  it('keeps CLI callees on execution edges and omits snapshot noise', () => {
    const result = runCli(testDir, ['callees', 'entryPoint']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Callees of "entryPoint"');
    expect(result.stdout).toContain('localStep');
    expect(result.stdout).not.toContain('FlowResult');
    expect(result.stdout).not.toContain('snapshotOnly');
    expect(result.stdout).toContain('Omitted 1 low-signal relationship');
    expect(result.stdout).toMatch(/Omitted \d+ non-execution reference\/type\/import relationships?/);
  });

  it('clamps CLI callees limit at the MCP minimum instead of returning an empty slice', () => {
    const result = runCli(testDir, ['callees', 'entryPoint', '--limit', '0']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Callees of "entryPoint"');
    expect(result.stdout).not.toContain('No callees found');
  });

  it('narrows CLI callees to one same-named definition by file', () => {
    const broad = runCli(testDir, ['callees', 'entryPoint']);
    const narrowed = runCli(testDir, ['callees', 'entryPoint', '--file', 'src/mcp/flow.ts']);

    expect(broad.status).toBe(0);
    expect(narrowed.status).toBe(0);
    expect(broad.stdout).toContain('src/other/flow.ts');
    expect(narrowed.stdout).toContain('src/mcp/flow.ts');
    expect(narrowed.stdout).not.toContain('src/other/flow.ts');
    expect(narrowed.stdout).not.toContain('otherStep');
  });

  it('keeps CLI callers from treating research snapshots as first-party callers', () => {
    const result = runCli(testDir, ['callers', 'localStep']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Callers of "localStep"');
    expect(result.stdout).toContain('entryPoint');
    expect(result.stdout).not.toContain('snapshotCaller');
    expect(result.stdout).toContain('Omitted 1 low-signal relationship');
  });

  it('narrows CLI callers to one same-named definition by file', () => {
    const broad = runCli(testDir, ['callers', 'localStep']);
    const narrowed = runCli(testDir, ['callers', 'localStep', '--file', 'src/mcp/flow.ts']);

    expect(broad.status).toBe(0);
    expect(narrowed.status).toBe(0);
    expect(broad.stdout).toContain('src/other/flow.ts');
    expect(narrowed.stdout).toContain('src/mcp/flow.ts');
    expect(narrowed.stdout).not.toContain('src/other/flow.ts');
  });

  it('narrows CLI impact to one same-named definition by file', () => {
    const result = runCli(testDir, ['impact', 'entryPoint', '--file', 'src/mcp/flow.ts', '--json']);
    const payload = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(payload.file).toBe('src/mcp/flow.ts');
    expect(payload.filterMatched).toBe(true);
    expect(JSON.stringify(payload.affected)).not.toContain('src/other/flow.ts');
  });

  it('keeps CLI explore flow aligned with cross-language call-surface edges', () => {
    const result = runCli(testDir, ['explore', 'entryPoint', 'runPythonReport', 'renderReport']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('## Flow (call path among the symbols you queried)');
    expect(result.stdout).toMatch(/1\. entryPoint[\s\S]*2\. runPythonReport[\s\S]*3\. renderReport/);
    expect(result.stdout).toContain('dynamic: general crosslang');
  });
});

describe('CLI serve help', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-cli-serve-'));
  });

  afterEach(() => {
    if (testDir && fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('separates the default MCP surface from opt-in tools', () => {
    const result = runCli(testDir, ['serve']);
    const text = result.stderr;

    expect(result.status).toBe(0);
    expect(text).toContain('Default tools:');
    expect(text).toContain('omniweave_explore');
    expect(text).toContain('omniweave_search');
    expect(text).toContain('omniweave_callers');
    expect(text).toContain('omniweave_impact');
    expect(text).toContain('omniweave_node');
    expect(text).toContain('Opt-in tools via OMNIWEAVE_MCP_TOOLS:');
    expect(text.indexOf('omniweave_node')).toBeLessThan(text.indexOf('Opt-in tools'));
    expect(text.indexOf('omniweave_callees')).toBeGreaterThan(text.indexOf('Opt-in tools'));
    expect(text.indexOf('omniweave_files')).toBeGreaterThan(text.indexOf('Opt-in tools'));
    expect(text.indexOf('omniweave_status')).toBeGreaterThan(text.indexOf('Opt-in tools'));
  });

  it('describes explore max-files as an adaptive default', () => {
    const result = runCli(testDir, ['explore', '--help']);
    const text = result.stdout + result.stderr;

    expect(result.status).toBe(0);
    expect(text).toContain('--max-files <number>');
    expect(text).toMatch(/default\s+is adaptive by project size/);
    expect(text).not.toContain('default: 12');
  });

  it('exposes node line disambiguation in shell help', () => {
    const result = runCli(testDir, ['node', '--help']);
    const text = result.stdout + result.stderr;

    expect(result.status).toBe(0);
    expect(text).toContain('--line <number>');
    expect(text).toMatch(/definition at or near this\s+line/);
  });

  it('exposes file narrowing on CLI graph traversal tools', () => {
    for (const command of ['callers', 'callees', 'impact']) {
      const result = runCli(testDir, [command, '--help']);
      const text = result.stdout + result.stderr;

      expect(result.status).toBe(0);
      expect(text).toContain('--file <file>');
      expect(text).toContain('Narrow to the definition in this file');
    }
  });
});
