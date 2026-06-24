import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { OmniWeave } from '../src';
import { ToolHandler } from '../src/mcp/tools';

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

  it('indexes selected non-source text files without indexing secret-prone config values', async () => {
    fs.mkdirSync(path.join(dir, 'locales'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'secrets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'locales', 'en.json'), '{"wireframeToCode":"Wireframe to code"}\n');
    fs.writeFileSync(path.join(dir, 'README.md'), '# Wireframe to code in docs\n');
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=sk-live-DO-NOT-LEAK\n');
    fs.writeFileSync(path.join(dir, '.envrc'), 'export SECRET=sk-live-DO-NOT-LEAK\n');
    fs.writeFileSync(path.join(dir, 'prod.env.txt'), 'SECRET=sk-live-DO-NOT-LEAK\n');
    fs.writeFileSync(path.join(dir, 'api-key.txt'), 'SECRET=sk-live-DO-NOT-LEAK\n');
    fs.writeFileSync(path.join(dir, 'private_key.md'), 'SECRET=sk-live-DO-NOT-LEAK\n');
    fs.writeFileSync(path.join(dir, 'id_rsa.txt'), 'SECRET=sk-live-DO-NOT-LEAK\n');
    fs.writeFileSync(path.join(dir, 'service-account.md'), 'SECRET=sk-live-DO-NOT-LEAK\n');
    fs.writeFileSync(path.join(dir, 'secrets', 'README.md'), 'SECRET=sk-live-DO-NOT-LEAK\n');
    fs.writeFileSync(path.join(dir, 'application.yml'), 'spring:\n  datasource:\n    password: sk-live-DO-NOT-LEAK\n');

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    expect(cg.searchContent('Wireframe to code', 10).results.map((r) => r.path).sort()).toEqual([
      'README.md',
      'locales/en.json',
    ]);
    expect(cg.searchContent('sk-live-DO-NOT-LEAK', 10).results).toEqual([]);

    cg.close?.();
  });

  it('does not follow content-only symlinks outside the project root', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'content-fts-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'outside-secret.md'), '# outside raw-content marker\n');
      fs.symlinkSync(path.join(outside, 'outside-secret.md'), path.join(dir, 'README.md'));

      const cg = await OmniWeave.init(dir, { silent: true });
      await cg.indexAll();

      expect(cg.searchContent('outside raw-content marker', 10).results).toEqual([]);

      cg.close?.();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('does not index invalid UTF-8 content-only text files', async () => {
    fs.writeFileSync(path.join(dir, 'README.md'), Buffer.from([0xff, 0xfe, 0xfd, 0x20, 0x61, 0x62, 0x63]));

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    expect(cg.contentIndexFileCount()).toBe(0);

    cg.close?.();
  });

  it('does not treat external repository snapshot docs as content-only index input', async () => {
    const snapshotDir = path.join(dir, 'research/2026-06-24-example/repos/tool');
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), '# first-party docs marker\n');
    fs.writeFileSync(path.join(snapshotDir, 'README.md'), '# external snapshot marker\n');

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    expect(cg.searchContent('first-party docs marker', 10).results.map((r) => r.path)).toEqual(['README.md']);
    expect(cg.searchContent('external snapshot marker', 10).results).toEqual([]);
    expect(cg.getChangedFiles().added).not.toContain('research/2026-06-24-example/repos/tool/README.md');

    cg.close?.();
  });

  it('does not surface stale content-only housekeeping as source-graph staleness', async () => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'export function entry() { return 1; }\n');

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();
    const stalePath = 'research/2026-06-24-example/repos/tool/README.md';
    const raw = cg as unknown as {
      queries: { upsertFileContent(path: string, content: string): void };
      getChangedSourceFiles(): { added: string[]; modified: string[]; removed: string[] };
    };
    raw.queries.upsertFileContent(stalePath, '# external snapshot marker\n');

    expect(cg.getChangedFiles().removed).toContain(stalePath);
    expect(raw.getChangedSourceFiles().removed).not.toContain(stalePath);

    const result = await new ToolHandler(cg).execute('omniweave_explore', { query: 'entry' });
    const text = result.content.map((c) => c.text).join('\n');
    expect(text).toContain('entry');
    expect(text).not.toContain(stalePath);
    expect(text).not.toContain('elsewhere in this project');

    cg.close?.();
  });

  it('purges legacy unsafe source content rows during ordinary sync', async () => {
    const secret = 'legacy-raw-config-secret';
    fs.writeFileSync(path.join(dir, 'application.properties'), `spring.datasource.password=${secret}\n`);

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();
    const raw = cg as unknown as {
      queries: { upsertFileContent(path: string, content: string): void };
    };
    raw.queries.upsertFileContent('application.properties', `spring.datasource.password=${secret}\n`);
    expect(cg.searchContent(secret, 10).results.map((r) => r.path)).toEqual(['application.properties']);
    expect(cg.getChangedFiles().modified).toContain('application.properties');

    await cg.sync();

    expect(cg.searchContent(secret, 10).results).toEqual([]);
    expect(cg.getChangedFiles().modified).not.toContain('application.properties');

    cg.close?.();
  });

  it('syncs selected non-source text rows on add, modify, and delete', async () => {
    fs.writeFileSync(path.join(dir, 'README.md'), '# old marker\n');

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();
    expect(cg.searchContent('old marker', 10).results.map((r) => r.path)).toEqual(['README.md']);

    fs.writeFileSync(path.join(dir, 'README.md'), '# new marker\n');
    await cg.sync();
    expect(cg.searchContent('old marker', 10).results).toEqual([]);
    expect(cg.searchContent('new marker', 10).results.map((r) => r.path)).toEqual(['README.md']);

    fs.rmSync(path.join(dir, 'README.md'));
    await cg.sync();
    expect(cg.searchContent('new marker', 10).results).toEqual([]);

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

  it('surfaces explicit MCP pattern mode with sanitized snippets', async () => {
    fs.writeFileSync(
      path.join(dir, 'literal.ts'),
      'export const msg = "``` marker_content_search\\nsecond line";\n'
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const result = await new ToolHandler(cg).execute('omniweave_search', {
      query: 'pattern:marker_content_search',
    });
    const text = result.content[0]?.text ?? '';

    expect(result.isError).toBeUndefined();
    expect(text).toContain('Files containing the literal "marker_content_search"');
    expect(text).toContain('literal.ts');
    expect(text).toContain('Raw-content file/snippet hits only');
    expect(text).toContain('key: `omniweave_node file="literal.ts"`');
    expect(text).not.toContain('```');

    cg.close?.();
  });

  it('keeps too-short MCP content patterns success-shaped', async () => {
    fs.writeFileSync(path.join(dir, 'short.ts'), 'export const x = "ab";\n');

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const result = await new ToolHandler(cg).execute('omniweave_search', {
      query: 'pattern:ab',
    });
    const text = result.content[0]?.text ?? '';

    expect(result.isError).toBeUndefined();
    expect(text).toContain('at least 3 characters');
    expect(text).toContain('not a tool failure');

    cg.close?.();
  });
});
