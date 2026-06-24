import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { OmniWeave } from '../src';

/**
 * Raw file-content trigram index (`content_fts`) — the one retrieval axis the
 * symbol-only `nodes_fts` cannot answer: "which files contain string Y" where Y
 * is a literal that is NOT a symbol (an error message, a config value, a comment).
 * This locks the library surface (`queries.searchContent` / `contentIndexFileCount`):
 * population on index, snippet + path return, literal-substring (not regex) match,
 * the <3-char trigram floor, absence, and lockstep removal on file delete.
 */
describe('content_fts (raw file-content search)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-fts-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('finds a non-symbol string literal by content and returns path + snippet', async () => {
    fs.writeFileSync(
      path.join(dir, 'csrf.py'),
      `def reject(request):\n    raise PermissionDenied("CSRF verification failed")\n`
    );
    fs.writeFileSync(path.join(dir, 'other.py'), `def noop():\n    return 0\n`);

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();
    const q = cg; // exercise the public OmniWeave.searchContent / contentIndexFileCount surface

    expect(q.contentIndexFileCount()).toBe(2);

    // The string lives inside a function body — not a symbol — so nodes_fts/search
    // can't find it, but content_fts can.
    const hit = q.searchContent('CSRF verification failed', 5);
    expect(hit.results.length).toBe(1);
    expect(hit.results[0].path).toBe('csrf.py');
    expect(hit.results[0].snippet).toContain('verification');

    // Absent literal → empty (not a false hit).
    expect(q.searchContent('this string is not present anywhere', 5).results).toEqual([]);

    // Trigram floor: a <3-char pattern cannot be indexed → empty, honestly.
    expect(q.searchContent('ab', 5).results).toEqual([]);

    cg.close?.();
  });

  it('reports truncation via hasMore and respects the limit', async () => {
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(dir, `f${i}.py`), `# marker_token_xyz in file ${i}\n`);
    }
    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();
    const q = cg; // exercise the public OmniWeave.searchContent / contentIndexFileCount surface

    const limited = q.searchContent('marker_token_xyz', 3);
    expect(limited.results.length).toBe(3);
    expect(limited.hasMore).toBe(true);

    const full = q.searchContent('marker_token_xyz', 10);
    expect(full.results.length).toBe(5);
    expect(full.hasMore).toBe(false);

    cg.close?.();
  });

  it('drops a removed file from the content index in lockstep', async () => {
    const target = path.join(dir, 'gone.py');
    fs.writeFileSync(target, `# unique_marker_to_remove\n`);
    fs.writeFileSync(path.join(dir, 'keep.py'), `# kept\n`);

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();
    const q = cg; // exercise the public OmniWeave.searchContent / contentIndexFileCount surface
    expect(q.searchContent('unique_marker_to_remove', 5).results.length).toBe(1);

    // Remove the file from disk and sync — the content row must go with it.
    fs.rmSync(target);
    await cg.sync();
    expect(q.searchContent('unique_marker_to_remove', 5).results).toEqual([]);
    expect(q.contentIndexFileCount()).toBe(1);

    cg.close?.();
  });
});
