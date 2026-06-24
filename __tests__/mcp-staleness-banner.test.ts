/**
 * Per-file staleness banner on MCP tool responses (issue #403).
 *
 * The watcher tracks every file event since the last successful sync; the
 * tool dispatcher intersects "files referenced in this response" with that
 * pending set and prepends a banner ("⚠️ Some files referenced below were
 * edited since the last index sync…") plus an optional footer ("(Note: N
 * file(s) elsewhere in this project are pending index sync…)").
 *
 * No auto-flush, no static wait — the response is instant and the agent
 * decides whether to verify the specific stale file or refresh the index. These tests exercise
 * the full real path: real OmniWeave index + real ToolHandler.execute().
 *
 * **Event delivery uses a synthetic seam** (`__emitWatchEventForTests`): the
 * real native fs.watch (FSEvents/inotify) delivery is non-deterministic under
 * parallel vitest execution and produced a consistent ~30% failure rate on
 * these tests when run inside the full suite. The seam drives the watcher's
 * pending-set pipeline directly so the tests synthesize file events
 * deterministically. The watcher's actual debounce timer (real setTimeout) is
 * left untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import OmniWeave from '../src/index';
import { ToolHandler } from '../src/mcp/tools';
import { __emitWatchEventForTests } from '../src/sync/watcher';

function waitFor(condition: () => boolean, timeoutMs = 2000, intervalMs = 25): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

describe('MCP staleness banner', () => {
  let testDir: string;
  let cg: OmniWeave;
  let handler: ToolHandler;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-stale-banner-'));
    fs.mkdirSync(path.join(testDir, 'src'));
    // Three isolated files with no cross-references — keeps each test's
    // "which path does the response mention?" assertion unambiguous. If the
    // files shared imports/calls, omniweave_search responses would surface
    // multiple file paths and the banner-vs-footer split would be racy.
    fs.writeFileSync(
      path.join(testDir, 'src', 'alpha-only.ts'),
      'export function alphaOnly() { return 1; }\n',
    );
    fs.writeFileSync(
      path.join(testDir, 'src', 'bravo-only.ts'),
      'export function bravoOnly() { return 2; }\n',
    );
    fs.writeFileSync(
      path.join(testDir, 'src', 'charlie-only.ts'),
      'export function charlieOnly() { return 3; }\n',
    );
    fs.writeFileSync(
      path.join(testDir, 'src', 'prefix.ts'),
      'export function shortUnrelatedOnly() { return 4; }\n',
    );
    fs.writeFileSync(
      path.join(testDir, 'src', 'prefix.ts-extra.ts'),
      'export function longUniqueOnly() { return 5; }\n',
    );

    cg = OmniWeave.initSync(testDir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    handler = new ToolHandler(cg);
  });

  afterEach(() => {
    try { cg.unwatch(); } catch { /* ignore */ }
    try { cg.close(); } catch { /* ignore */ }
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('prepends a stale banner when the response references a pending file', async () => {
    // Long debounce so the edit lingers in pendingFiles while we query.
    cg.watch({ debounceMs: 4000, inertForTests: true });
    await cg.waitUntilWatcherReady();

    // Real disk write so a later sync (if it fires) sees the new content,
    // plus a synthesized chokidar event so the watcher's pendingFiles set
    // updates immediately without waiting on OS-level event delivery.
    fs.writeFileSync(
      path.join(testDir, 'src', 'alpha-only.ts'),
      'export function alphaOnly() { return 99; }\n',
    );
    __emitWatchEventForTests(testDir, 'src/alpha-only.ts');

    // With mocked chokidar this is synchronous — keep the wait just to
    // exercise the realistic shape (the watcher's `chokidarReady` gate
    // and the small window before the pending-file Map is populated).
    await waitFor(() => cg.getPendingFiles().some((p) => p.path === 'src/alpha-only.ts'));

    const res = await handler.execute('omniweave_search', { query: 'alphaOnly' });
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;

    // Banner shape: warning glyph + filename + actionable instruction.
    expect(text.startsWith('⚠️')).toBe(true);
    expect(text).toContain('src/alpha-only.ts');
    expect(text).toMatch(/edited \d+ms ago/);
    expect(text).toMatch(/symbols, edges, or line ranges may be stale/);
    expect(text).toMatch(/omniweave_node <path>/);
    expect(text).toMatch(/omniweave sync/);
    expect(text).not.toMatch(/Read them directly/);
    // The actual result must still follow the banner.
    expect(text).toMatch(/alphaOnly/);
  });

  it('marks omniweave_explore stale while still showing current disk source bytes', async () => {
    cg.watch({ debounceMs: 4000, inertForTests: true });
    await cg.waitUntilWatcherReady();

    fs.writeFileSync(
      path.join(testDir, 'src', 'alpha-only.ts'),
      'export function alphaOnly() { return 99; }\n',
    );
    __emitWatchEventForTests(testDir, 'src/alpha-only.ts');
    await waitFor(() => cg.getPendingFiles().some((p) => p.path === 'src/alpha-only.ts'));

    const res = await handler.execute('omniweave_explore', { query: 'alphaOnly', maxFiles: 3 });
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;

    expect(text.startsWith('⚠️')).toBe(true);
    expect(text).toContain('src/alpha-only.ts');
    expect(text).toMatch(/symbols, edges, or line ranges may be stale/);
    expect(text).toContain('return 99');
    expect(text).toContain('### Source Code');
  });

  it('falls back to changed-files freshness when no watcher is active', async () => {
    fs.writeFileSync(
      path.join(testDir, 'src', 'alpha-only.ts'),
      'export function alphaOnly() { return 99; }\n',
    );

    const res = await handler.execute('omniweave_explore', { query: 'alphaOnly', maxFiles: 3 });
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;

    expect(text.startsWith('⚠️')).toBe(true);
    expect(text).toContain('index is behind the worktree');
    expect(text).toContain('src/alpha-only.ts (modified)');
    expect(text).toContain('symbols, edges, ranking, and line ranges may still come from the old index');
    expect(text).toContain('omniweave sync');
    expect(text).toContain('return 99');
    expect(text).toContain('### Source Code');
  });

  it('shows changed files in omniweave_status when no watcher is active', async () => {
    fs.writeFileSync(
      path.join(testDir, 'src', 'alpha-only.ts'),
      'export function alphaOnly() { return 99; }\n',
    );
    fs.writeFileSync(
      path.join(testDir, 'src', 'new-feature.ts'),
      'export function brandNewFeature() { return 42; }\n',
    );

    const res = await handler.execute('omniweave_status', {});
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;

    expect(text).toContain('### Source graph changes since last index:');
    expect(text).toContain('**Runtime build:**');
    expect(text).toContain('src/alpha-only.ts (modified)');
    expect(text).toContain('src/new-feature.ts (added)');
    expect(text).toContain('Run `omniweave sync` before trusting structural relationships.');
    expect(text).not.toContain('### Pending sync:');
  });

  it('keeps low-signal source changes out of ordinary stale footers', async () => {
    const snapshotDir = path.join(testDir, 'research/2026-06-24-example/repos/tool');
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.writeFileSync(
      path.join(snapshotDir, 'fixture.ts'),
      'export function snapshotOnly() { return 1; }\n',
    );

    const explore = await handler.execute('omniweave_explore', { query: 'alphaOnly', maxFiles: 3 });
    expect(explore.isError).toBeFalsy();
    const exploreText = explore.content[0].text;
    expect(exploreText).toContain('alphaOnly');
    expect(exploreText).not.toMatch(/elsewhere in this project changed since the last index/);
    expect(exploreText).not.toContain('research/2026-06-24-example/repos/tool/fixture.ts');

    const status = await handler.execute('omniweave_status', {});
    expect(status.isError).toBeFalsy();
    const statusText = status.content[0].text;
    expect(statusText).toContain('### Low-signal source maintenance:');
    expect(statusText).toContain('research/2026-06-24-example/repos/tool/fixture.ts (added)');
    expect(statusText).not.toContain('### Source graph changes since last index:');
    expect(statusText).not.toContain('Run `omniweave sync` before trusting structural relationships.');
  });

  it('warns that empty explore results may be stale when new files are not indexed yet', async () => {
    fs.writeFileSync(
      path.join(testDir, 'src', 'new-feature.ts'),
      'export function brandNewFeature() { return 42; }\n',
    );

    const res = await handler.execute('omniweave_explore', { query: 'brandNewFeature', maxFiles: 3 });
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;

    expect(text.startsWith('⚠️')).toBe(true);
    expect(text).toContain('empty explore result may be stale');
    expect(text).toContain('src/new-feature.ts (added)');
    expect(text).toContain('run `omniweave sync`');
    expect(text).toContain('use normal file tools for that path');
    expect(text).toContain('No relevant code found for "brandNewFeature"');
    expect(text).not.toContain('elsewhere in this project changed since the last index');
  });

  it('warns that empty explore results may be stale while a watcher event is pending', async () => {
    cg.watch({ debounceMs: 4000, inertForTests: true });
    await cg.waitUntilWatcherReady();

    fs.writeFileSync(
      path.join(testDir, 'src', 'pending-new-feature.ts'),
      'export function pendingNewFeature() { return 42; }\n',
    );
    __emitWatchEventForTests(testDir, 'src/pending-new-feature.ts');
    await waitFor(() => cg.getPendingFiles().some((p) => p.path === 'src/pending-new-feature.ts'));

    const res = await handler.execute('omniweave_explore', { query: 'pendingNewFeature', maxFiles: 3 });
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;

    expect(text.startsWith('⚠️')).toBe(true);
    expect(text).toContain('empty explore result may be stale');
    expect(text).toContain('src/pending-new-feature.ts');
    expect(text).toContain('pending sync');
    expect(text).toContain('No relevant code found for "pendingNewFeature"');
    expect(text).toContain('re-run `omniweave_explore`');
    expect(text).toContain('run `omniweave sync`');
    expect(text).not.toContain('omniweave explore');
  });

  it('falls back to changed-files freshness when an active watcher misses an event', async () => {
    cg.watch({ debounceMs: 4000, inertForTests: true });
    await cg.waitUntilWatcherReady();

    fs.writeFileSync(
      path.join(testDir, 'src', 'alpha-only.ts'),
      'export function alphaOnly() { return 99; }\n',
    );

    expect(cg.isWatching()).toBe(true);
    expect(cg.getPendingFiles()).toEqual([]);

    const res = await handler.execute('omniweave_explore', { query: 'alphaOnly', maxFiles: 3 });
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;

    expect(text.startsWith('⚠️')).toBe(true);
    expect(text).toContain('index is behind the worktree');
    expect(text).toContain('src/alpha-only.ts (modified)');
    expect(text).toContain('symbols, edges, ranking, and line ranges may still come from the old index');
    expect(text).toContain('return 99');
    expect(text).toContain('### Source Code');
  });

  it('shows changed files in status when an active watcher misses an event', async () => {
    cg.watch({ debounceMs: 4000, inertForTests: true });
    await cg.waitUntilWatcherReady();

    fs.writeFileSync(
      path.join(testDir, 'src', 'alpha-only.ts'),
      'export function alphaOnly() { return 99; }\n',
    );

    expect(cg.isWatching()).toBe(true);
    expect(cg.getPendingFiles()).toEqual([]);

    const res = await handler.execute('omniweave_status', {});
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;

    expect(text).toContain('### Source graph changes since last index:');
    expect(text).toContain('src/alpha-only.ts (modified)');
    expect(text).toContain('Run `omniweave sync` before trusting structural relationships.');
  });

  it('does not treat a changed path as referenced when it is only a prefix of another path', async () => {
    fs.writeFileSync(
      path.join(testDir, 'src', 'prefix.ts'),
      'export function shortUnrelatedOnly() { return 44; }\n',
    );

    const res = await handler.execute('omniweave_explore', { query: 'longUniqueOnly', maxFiles: 3 });
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;

    expect(text.startsWith('⚠️')).toBe(false);
    expect(text).toContain('src/prefix.ts-extra.ts');
    expect(text).toContain('longUniqueOnly');
    expect(text).toMatch(/elsewhere in this project changed since the last index/);
    expect(text).toContain('src/prefix.ts (modified)');
  });

  it('treats deleted indexed files as stale references instead of silent missing source', async () => {
    fs.rmSync(path.join(testDir, 'src', 'alpha-only.ts'));

    const res = await handler.execute('omniweave_explore', { query: 'alphaOnly', maxFiles: 3 });
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;

    expect(text.startsWith('⚠️')).toBe(true);
    expect(text).toContain('index is behind the worktree');
    expect(text).toContain('src/alpha-only.ts (removed)');
    expect(text).toContain('indexed but missing on disk');
    expect(text).toContain('Treat these symbol and relationship hits as stale');
    expect(text).not.toContain('elsewhere in this project changed since the last index');
    expect(text).not.toContain('return 1');
  });

  it('uses the footer (not the banner) when pending files are not referenced', async () => {
    cg.watch({ debounceMs: 4000, inertForTests: true });
    await cg.waitUntilWatcherReady();

    // Edit bravo-only.ts but search for the alphaOnly symbol, whose hit is
    // only in alpha-only.ts. The two files share no imports/calls so the
    // response text won't mention bravo-only.ts.
    fs.writeFileSync(
      path.join(testDir, 'src', 'bravo-only.ts'),
      'export function bravoOnly() { return 22; }\n',
    );
    __emitWatchEventForTests(testDir, 'src/bravo-only.ts');
    await waitFor(() => cg.getPendingFiles().some((p) => p.path === 'src/bravo-only.ts'));

    const res = await handler.execute('omniweave_search', { query: 'alphaOnly' });
    const text = res.content[0].text;

    expect(text.startsWith('⚠️')).toBe(false);
    expect(text).toMatch(/elsewhere in this project are pending index sync/);
    expect(text).toContain('src/bravo-only.ts');
  });

  it('drops the banner once the sync completes and clears the pending entry', async () => {
    cg.watch({ debounceMs: 200, inertForTests: true });
    await cg.waitUntilWatcherReady();

    fs.writeFileSync(
      path.join(testDir, 'src', 'alpha-only.ts'),
      'export function alphaOnly() { return 7; }\n',
    );
    __emitWatchEventForTests(testDir, 'src/alpha-only.ts');
    // Wait through debounce (200ms) + sync; pendingFiles drains back to empty.
    await waitFor(() => cg.getPendingFiles().length === 0, 3000);

    const res = await handler.execute('omniweave_search', { query: 'alphaOnly' });
    const text = res.content[0].text;
    expect(text.startsWith('⚠️')).toBe(false);
    expect(text).not.toMatch(/elsewhere in this project are pending index sync/);
  });

  it('lists pending files under "Pending sync" in omniweave_status', async () => {
    cg.watch({ debounceMs: 4000, inertForTests: true });
    await cg.waitUntilWatcherReady();

    fs.writeFileSync(
      path.join(testDir, 'src', 'charlie-only.ts'),
      'export function charlieOnly() { return 33; }\n',
    );
    __emitWatchEventForTests(testDir, 'src/charlie-only.ts');
    await waitFor(() => cg.getPendingFiles().some((p) => p.path === 'src/charlie-only.ts'));

    const res = await handler.execute('omniweave_status', {});
    const text = res.content[0].text;
    expect(text).toContain('### Pending sync:');
    expect(text).toContain('src/charlie-only.ts');
    // Status embeds the info first-class, so the auto-banner is suppressed.
    expect(text.startsWith('⚠️')).toBe(false);
  });

  it('returns zero pending files when no watcher is active', () => {
    expect(cg.getPendingFiles()).toEqual([]);
  });
});
