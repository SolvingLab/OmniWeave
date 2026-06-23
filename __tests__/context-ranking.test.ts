/**
 * Context ranking: common-word precision + low-confidence handoff.
 *
 * Regression coverage for the failure where a prose query
 * ("capture intro onboarding screen flat object") surfaced an unrelated
 * constant named `FLAT` (in a download script) as a top entry point — because
 * the descriptive word "flat" exact-matched it and the +exact-name bonus was
 * exempt from single-term dampening. The fix: only distinctive identifiers earn
 * that exemption; an isolated common-word exact match is demoted, and a query
 * that resolves only to such weak matches is flagged low-confidence so the
 * response hands off to explore/trace instead of bluffing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import OmniWeave from '../src/index';
import { LOW_CONFIDENCE_MARKER } from '../src/context';
import {
  isDistinctiveIdentifier,
  isLowSignalSourceQuery,
  isRepositorySnapshotQuery,
  scorePathRelevance,
  deriveProjectNameTokens,
} from '../src/search/query-utils';
import { ToolHandler } from '../src/mcp/tools';

describe('isDistinctiveIdentifier', () => {
  it('treats plain dictionary words as non-distinctive', () => {
    for (const word of ['flat', 'object', 'screen', 'standing', 'capture']) {
      expect(isDistinctiveIdentifier(word)).toBe(false);
    }
  });

  it('treats leading-capital-only words (proper nouns / sentence start) as non-distinctive', () => {
    expect(isDistinctiveIdentifier('Screen')).toBe(false);
    expect(isDistinctiveIdentifier('Zustand')).toBe(false);
  });

  it('treats camelCase / PascalCase / snake_case / acronyms / digits as distinctive', () => {
    expect(isDistinctiveIdentifier('setLastEmail')).toBe(true);
    expect(isDistinctiveIdentifier('OrgUserStore')).toBe(true);
    expect(isDistinctiveIdentifier('user_store')).toBe(true);
    expect(isDistinctiveIdentifier('REST')).toBe(true);
    expect(isDistinctiveIdentifier('v2')).toBe(true);
  });
});

// A single PascalCase query word (notably a project name a user naturally
// includes) splits into sub-tokens that all match the SAME path segment; summed
// per sub-token it boosted that path 4×, burying the rest of the query's stack
// (#720). Path relevance must count each original WORD once per level, while
// still splitting it for cross-convention matching.
describe('scorePathRelevance per-word scoring (#720)', () => {
  it('counts a single PascalCase word once per path level, not once per sub-token', () => {
    // "SuperBizAgent" → super/biz/agent/superbizagent all hit the dir, but it's
    // one concept: +5 (dir) once, not +20.
    expect(scorePathRelevance('SuperBizAgentFrontend/app.js', 'SuperBizAgent')).toBe(5);
  });

  it('still splits a word so it matches across naming conventions', () => {
    // getUserName must still match a snake_case path via its sub-tokens.
    expect(scorePathRelevance('get_user_name.go', 'getUserName')).toBeGreaterThanOrEqual(10);
  });

  it('still credits distinct query words matching different path segments', () => {
    // auth (dir) and handler (filename) are separate concepts — each counts.
    expect(scorePathRelevance('src/auth/login_handler.go', 'auth handler')).toBeGreaterThan(
      scorePathRelevance('src/auth/login_handler.go', 'auth')
    );
  });
});

// The project name is context, not a discriminator: dropping it from path
// scoring stops every file under a `<ProjectName>…/` tree from winning on the
// name alone, so the rest of the query decides the ranking (#720).
describe('project-name down-weighting in path relevance (#720)', () => {
  it('derives the project name from go.mod / package.json, skipping short names', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-projname-'));
    try {
      fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/SuperBizAgent\n\ngo 1.21\n');
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@acme/superbizagent-web' }));
      const tokens = deriveProjectNameTokens(dir);
      expect(tokens.has('superbizagent')).toBe(true);
      expect(tokens.has('superbizagentweb')).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops a project-name query word from path scoring when other words remain', () => {
    const proj = new Set(['superbizagent']);
    // Without the project name dropped, the frontend path wins on it (+5).
    // With it dropped, only "backend" is left — and it doesn't match this path.
    const withDrop = scorePathRelevance('SuperBizAgentFrontend/app.js', 'SuperBizAgent backend', proj);
    const noDrop = scorePathRelevance('SuperBizAgentFrontend/app.js', 'SuperBizAgent backend');
    expect(withDrop).toBeLessThan(noDrop);
    expect(withDrop).toBe(0);
  });

  it('keeps the project-name word when it is the ONLY query word (bare query still scores)', () => {
    const proj = new Set(['superbizagent']);
    expect(scorePathRelevance('SuperBizAgentFrontend/app.js', 'SuperBizAgent', proj)).toBe(5);
  });

  it('does not affect a query that omits the project name', () => {
    const proj = new Set(['superbizagent']);
    const path0 = 'internal/controller/chat/chat.go';
    expect(scorePathRelevance(path0, 'controller chat', proj)).toBe(
      scorePathRelevance(path0, 'controller chat')
    );
  });

  it('deprioritizes external research repository snapshots for ordinary code queries', () => {
    const firstParty = scorePathRelevance('src/mcp/tools.ts', 'mcp tools explore');
    const snapshot = scorePathRelevance(
      'research/2026-06-23-codegraph-ecosystem/repos/codegraph/src/mcp/tools.ts',
      'mcp tools explore'
    );

    expect(snapshot).toBeLessThan(firstParty);
  });

  it('keeps repository snapshots searchable when the query explicitly asks for them', () => {
    const snapshot = scorePathRelevance(
      'research/2026-06-23-codegraph-ecosystem/repos/codegraph/src/mcp/tools.ts',
      'external snapshot mcp tools'
    );

    expect(snapshot).toBeGreaterThan(0);
  });

  it('does not treat bare product snapshot/verify terms as low-signal source intent', () => {
    expect(isRepositorySnapshotQuery('snapshot verify import targetChecked')).toBe(false);
    expect(isLowSignalSourceQuery('snapshot verify import targetChecked')).toBe(false);
    expect(isRepositorySnapshotQuery('external snapshot Symbol')).toBe(true);
    expect(isRepositorySnapshotQuery('repo snapshot Symbol')).toBe(true);
  });

  it('does not treat the ordinary word repo as an external-snapshot request', () => {
    const firstParty = scorePathRelevance('src/mcp/tools.ts', 'large repo mcp tools');
    const snapshot = scorePathRelevance(
      'research/2026-06-23-codegraph-ecosystem/repos/codegraph/src/mcp/tools.ts',
      'large repo mcp tools'
    );

    expect(snapshot).toBeLessThan(firstParty);
  });
});

describe('Context ranking — common-word precision & confidence', () => {
  let testDir: string;
  let cg: OmniWeave;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-ctxrank-'));

    // The corroborated target: a capture-flow screen whose NAME alone matches
    // three query terms (capture + intro + screen), and which lives under a
    // matching directory.
    const captureDir = path.join(testDir, 'src', 'app', 'capture');
    fs.mkdirSync(captureDir, { recursive: true });
    fs.writeFileSync(
      path.join(captureDir, 'intro.tsx'),
      `export function CaptureIntroScreen() {
  // Onboarding screen shown before the user selects flat or standing object capture.
  return null;
}
`
    );

    // The trap: an unrelated constant literally named FLAT, in a totally
    // different area. "flat" in a prose query exact-matches it.
    const scriptsDir = path.join(testDir, 'scripts', 'dataset');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(
      path.join(scriptsDir, 'download.ts'),
      `export const FLAT = 'freiburg_flat_dataset';
export function downloadDataset(name: string): string { return name; }
`
    );

    cg = OmniWeave.initSync(testDir, {
      config: { include: ['**/*.ts', '**/*.tsx'], exclude: [] },
    });
    await cg.indexAll();
  });

  afterEach(() => {
    if (cg) cg.destroy();
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('does not let a common-word exact match (FLAT) outrank a corroborated symbol', async () => {
    const sg = await cg.findRelevantContext(
      'capture intro onboarding screen flat object'
    );
    const rootNames = sg.roots.map((id) => sg.nodes.get(id)?.name);

    // The corroborated capture screen surfaces as an entry point...
    expect(rootNames).toContain('CaptureIntroScreen');
    // ...and the trap constant is never the lead result (the bug we fixed).
    expect(rootNames[0]).not.toBe('FLAT');

    const capIdx = rootNames.indexOf('CaptureIntroScreen');
    const flatIdx = rootNames.indexOf('FLAT');
    if (flatIdx >= 0) expect(capIdx).toBeLessThan(flatIdx);

    // And it's confidently answered (we located a corroborated symbol).
    expect(sg.confidence).toBe('high');
  });

  it('flags low confidence and emits the handoff when only common words match', async () => {
    const query = 'flat object thing';
    const sg = await cg.findRelevantContext(query);
    expect(sg.confidence).toBe('low');

    const md = await cg.buildContext(query, { format: 'markdown' });
    expect(typeof md).toBe('string');
    expect(md as string).toContain(LOW_CONFIDENCE_MARKER);
    // The handoff routes to default precise tools rather than claiming completeness.
    expect(md as string).toMatch(/omniweave_explore/);
    expect(md as string).toMatch(/likely path hint/);
    expect(md as string).not.toContain('omniweave_files');
  });

  it('does not emit the handoff for a precise, distinctive-symbol query', async () => {
    const sg = await cg.findRelevantContext('CaptureIntroScreen');
    expect(sg.confidence).toBe('high');

    const md = await cg.buildContext('CaptureIntroScreen', { format: 'markdown' });
    expect(md as string).not.toContain(LOW_CONFIDENCE_MARKER);
  });
});

describe('omniweave_explore — low-signal repository snapshots', () => {
  let testDir: string;
  let cg: OmniWeave;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-snapshot-rank-'));

    const firstPartyMcp = path.join(testDir, 'src', 'mcp');
    const firstPartyContext = path.join(testDir, 'src', 'context');
    const firstPartySrc = path.join(testDir, 'src');
    const siteLib = path.join(testDir, 'site', 'src', 'lib');
    const exampleHelpers = path.join(testDir, 'examples', 'helpers');
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
    fs.mkdirSync(firstPartyContext, { recursive: true });
    fs.mkdirSync(firstPartySrc, { recursive: true });
    fs.mkdirSync(siteLib, { recursive: true });
    fs.mkdirSync(exampleHelpers, { recursive: true });
    fs.mkdirSync(overloads, { recursive: true });
    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(snapshotMcp, { recursive: true });

    fs.writeFileSync(
      path.join(firstPartyMcp, 'tools.ts'),
      `export interface ExploreOutputBudget {
  maxOutputChars: number;
  defaultMaxFiles: number;
}

export function getExploreOutputBudget(): ExploreOutputBudget {
  return { maxOutputChars: 24000, defaultMaxFiles: 8 };
}

export function buildExploreOutput(): string {
  return 'ranking budget truncation call path edge significance';
}
`
    );
    fs.writeFileSync(
      path.join(firstPartyContext, 'ranking.ts'),
      `export function rankExploreCandidates(): string {
  return buildRankingBudget('ranking budget truncation');
}

function buildRankingBudget(input: string): string {
  return input;
}
`
    );
    fs.writeFileSync(
      path.join(firstPartySrc, 'types.ts'),
      `export interface BuildContextOptions {
  rankingBudget: string;
  truncationBudget: string;
}

export interface Context {
  callPath: string;
}
`
    );
    fs.writeFileSync(
      path.join(firstPartySrc, 'snapshot.ts'),
      `export interface VerifySnapshotResult {
  targetChecked: boolean;
}

export function verifySnapshot(): VerifySnapshotResult {
  return { targetChecked: true };
}

export function importSnapshot(): string {
  return verifySnapshot().targetChecked ? 'imported' : 'unchecked';
}
`
    );
    fs.writeFileSync(
      path.join(siteLib, 'github.ts'),
      `export function format(value: string): string {
  return value.trim();
}
`
    );
    fs.writeFileSync(
      path.join(scripts, 'npm-sdk.js'),
      `var target = process.platform + '-' + process.arch;

module.exports = target;
`
    );
    fs.writeFileSync(
      path.join(exampleHelpers, 'dom.ts'),
      `export function empty(): null {
  return null;
}

export function large(): string {
  return 'large';
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
      path.join(snapshotMcp, 'tools.ts'),
      `export interface ExploreOutputBudget {
  maxOutputChars: number;
  defaultMaxFiles: number;
}

export function getExploreOutputBudget(): ExploreOutputBudget {
  return { maxOutputChars: 99999, defaultMaxFiles: 99 };
}

export function buildExploreOutput(): string {
  return 'external snapshot ranking budget truncation call path';
}

export function snapshotBuildExploreOutputCaller(): string {
  return buildExploreOutput();
}
`
    );
    fs.writeFileSync(
      path.join(snapshotMcp, 'symbol.ts'),
      `export class Symbol {
  parseFrom(): string {
    return 'external snapshot symbol';
  }
}
`
    );

    cg = OmniWeave.initSync(testDir, {
      config: { include: ['**/*.ts'], exclude: [] },
    });
    await cg.indexAll();
  });

  afterEach(() => {
    if (cg) cg.destroy();
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('keeps research repository snapshots out of default explore source output', async () => {
    const handler = new ToolHandler(cg);
    const result = await handler.execute('omniweave_explore', {
      query: 'buildExploreOutput rankExploreCandidates ranking budget truncation',
      maxFiles: 5,
    });
    const text = result.content.map((part) => part.text).join('\n');

    expect(text).toContain('src/mcp/tools.ts');
    expect(text).toContain('src/context/ranking.ts');
    expect(text).not.toContain('research/2026-06-23-codegraph-ecosystem/repos/codegraph/src/mcp/tools.ts');
  });

  it('does not seed same-name repository snapshots into default explore roots', async () => {
    const handler = new ToolHandler(cg);
    const result = await handler.execute('omniweave_explore', {
      query: 'buildExploreOutput',
      maxFiles: 5,
    });
    const text = result.content.map((part) => part.text).join('\n');

    expect(text).toContain('src/mcp/tools.ts');
    expect(text).not.toContain('research/2026-06-23-codegraph-ecosystem/repos/codegraph/src/mcp/tools.ts');
    expect(text).not.toContain('snapshotBuildExploreOutputCaller');
  });

  it('does not treat ordinary words in broad explore queries as named symbol seeds', async () => {
    const handler = new ToolHandler(cg);
    const result = await handler.execute('omniweave_explore', {
      query: 'buildExploreOutput rankExploreCandidates formatting empty large repo behavior',
      maxFiles: 5,
    });
    const text = result.content.map((part) => part.text).join('\n');

    expect(text).toContain('src/mcp/tools.ts');
    expect(text).toContain('src/context/ranking.ts');
    expect(text).not.toContain('site/src/lib/github.ts');
    expect(text).not.toContain('examples/helpers/dom.ts');
  });

  it('keeps multi-term mechanism matches ahead of isolated ordinary-word hits', async () => {
    const handler = new ToolHandler(cg);
    const result = await handler.execute('omniweave_explore', {
      query: 'explore large repo output budget max files truncation repository too large status stale warning',
      maxFiles: 5,
    });
    const text = result.content.map((part) => part.text).join('\n');

    expect(text).toContain('#### src/mcp/tools.ts');
    expect(text).toContain('getExploreOutputBudget');
    expect(text).not.toContain('examples/helpers/dom.ts');
    expect(text).not.toContain('research/2026-06-23-codegraph-ecosystem/repos/codegraph/src/mcp/tools.ts');
  });

  it('does not let CamelCase subtoken exact hits steal source slots', async () => {
    const handler = new ToolHandler(cg);
    const result = await handler.execute('omniweave_explore', {
      query: 'buildExploreOutput rankExploreCandidates formatContext ExploreOutputBudget ranking budget truncation',
      maxFiles: 5,
    });
    const text = result.content.map((part) => part.text).join('\n');

    expect(text).toContain('#### src/mcp/tools.ts');
    expect(text).toContain('#### src/context/ranking.ts');
    expect(text).not.toContain('site/src/lib/github.ts');
  });

  it('orders executable source sections before type-only support files', async () => {
    const handler = new ToolHandler(cg);
    const result = await handler.execute('omniweave_explore', {
      query: 'buildExploreOutput rankExploreCandidates BuildContextOptions Context ranking budget truncation',
      maxFiles: 5,
    });
    const text = result.content.map((part) => part.text).join('\n');

    const executableIndexes = [
      text.indexOf('#### src/mcp/tools.ts'),
      text.indexOf('#### src/context/ranking.ts'),
    ].filter((idx) => idx >= 0);
    const executableIdx = Math.min(...executableIndexes);
    const typesIdx = text.indexOf('#### src/types.ts');

    expect(executableIndexes.length).toBeGreaterThan(0);
    if (typesIdx >= 0) {
      expect(executableIdx).toBeLessThan(typesIdx);
    }
  });

  it('returns recovery guidance, not an error-shaped dead end, for empty explore results', async () => {
    const handler = new ToolHandler(cg);
    const result = await handler.execute('omniweave_explore', {
      query: 'xqzvbnmwrtypsdfghjkl',
      maxFiles: 5,
    });
    const text = result.content.map((part) => part.text).join('\n');

    expect(result.isError).not.toBe(true);
    expect(text).toContain('No relevant code found for "xqzvbnmwrtypsdfghjkl"');
    expect(text).toContain('not a tool failure');
    expect(text).toContain('omniweave_search');
    expect(text).toContain('omniweave_node');
    expect(text).toContain('refresh the index');
  });

  it('does not use external repository snapshots as the fallback for ordinary missing-symbol queries', async () => {
    const handler = new ToolHandler(cg);
    const result = await handler.execute('omniweave_explore', {
      query: 'NoSuchSymbolAbsolutelyMissing987654',
      maxFiles: 5,
    });
    const text = result.content.map((part) => part.text).join('\n');

    expect(result.isError).not.toBe(true);
    expect(text).toContain('No relevant code found for "NoSuchSymbolAbsolutelyMissing987654"');
    expect(text).not.toContain('research/2026-06-23-codegraph-ecosystem/repos/codegraph/src/mcp/symbol.ts');
  });

  it('keeps external repository snapshots available when explicitly requested', async () => {
    const handler = new ToolHandler(cg);
    const result = await handler.execute('omniweave_explore', {
      query: 'external snapshot Symbol',
      maxFiles: 5,
    });
    const text = result.content.map((part) => part.text).join('\n');

    expect(text).toContain('research/2026-06-23-codegraph-ecosystem/repos/codegraph/src/mcp/symbol.ts');
  });

  it('treats snapshot product queries as first-party code, not external repository snapshots', async () => {
    const handler = new ToolHandler(cg);
    const result = await handler.execute('omniweave_explore', {
      query: 'snapshot verify import targetChecked',
      maxFiles: 5,
    });
    const text = result.content.map((part) => part.text).join('\n');

    expect(text).toContain('#### src/snapshot.ts');
    expect(text).toContain('verifySnapshot');
    expect(text).not.toContain('research/2026-06-23-codegraph-ecosystem/repos/codegraph/src/mcp/');
    expect(text).not.toContain('scripts/npm-sdk.js');
  });

  it('flags a bare overloaded symbol as ambiguous instead of implying completeness', async () => {
    const handler = new ToolHandler(cg);
    const result = await handler.execute('omniweave_explore', {
      query: 'reconcile',
      maxFiles: 5,
    });
    const text = result.content.map((part) => part.text).join('\n');

    expect(result.isError).not.toBe(true);
    expect(text).toContain('### Ambiguous named symbols');
    expect(text).toContain('`reconcile` matched 5 callable definitions');
    expect(text).toContain('key: `omniweave_node symbol="reconcile" file="src/overloads/');
    expect(text).toContain('do not treat that subset as the full overload set');
    expect(text).toContain('omniweave_node');
    expect(text).not.toContain('Read them directly');
  });
});
