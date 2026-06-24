# content_fts — raw file-content trigram index: build + storage + honest caveats

**Date:** 2026-06-24 · the war plan's Step C "one new general lever": the only axis the
symbol-only `nodes_fts` cannot answer — *which files contain string Y* where Y is a literal
that is not a symbol (an error message, a config value, a comment). Built **in-process** in the
existing `node:sqlite` engine (FTS5 `tokenize='trigram'`), zero new dependency, zero-config
preserved.

## What landed (library foundation)

- `content_fts` standalone FTS5 trigram table (`schema.sql`) + schema migration **v6** so existing
  indexes gain it (empty until the next full index repopulates it from source — the raw bytes are
  not stored anywhere else).
- `QueryBuilder.upsertFileContent` (delete-then-insert by path, idempotent across index/sync),
  `deleteFileContent` (wired into `deleteFile` so the content index stays in lockstep with `files`),
  `searchContent(pattern, limit)` (literal substring, ranked, snippet + path, `hasMore`),
  `contentIndexFileCount` (0 ⇒ migrated-but-not-reindexed).
- Population in `storeExtractionResult` for files `<= MAX_FILE_SIZE` (1 MiB).
- Snapshot verifier allowlist extended with the 6 `content_fts*` shadow tables.
- Locked by `__tests__/content-fts.test.ts` (find-by-content, snippet, absence, `<3`-char trigram
  floor, `hasMore` truncation, lockstep removal on sync-delete).

**Not yet surfaced** to MCP/CLI — `searchContent` is a library method only. The `pattern:` mode on
`omniweave_search` + snapshot content-injection escaping are the next increment (deliberately
separate: it edits the hot `tools.ts`).

## Build + storage — measured on REAL django (@420b4f5b, 3,009 indexed files)

| metric | value |
|---|---|
| index wall-clock (full, with content_fts) | **29.0 s** for 3,009 files / 61,802 nodes / 196,029 edges |
| total DB | 180.3 MB |
| **content_fts (incl. shadow tables)** | **59.1 MB — 33% of the DB** |
| nodes_fts (symbol) | 5.6 MB |
| DB without content_fts | 121.2 MB |
| content_fts overhead | **1.49× the symbol-only DB** |

- **Build time:** the per-file content INSERT is negligible next to parsing — content_fts adds no
  measurable time to `init` (well under the war plan's ~30 s budget; the 29 s is dominated by
  tree-sitter parsing, which is unchanged).
- **Storage, honest:** content_fts is **~20 KB/file** on django (59.1 MB / 3,009). django is a
  **content-dense worst case** (vendored `.po` translation catalogs, migrations, docs). The war
  plan's `< 1 GB for < 50k files` gate is **at risk only on content-dense repos**: linearly,
  content_fts alone ≈ **0.98 GB at 50k django-like files** — right at the gate, and the *total* DB
  would be ~3 GB. A typical code repo (less prose/translation) runs far lighter. This is an honest
  ceiling to surface, not hide: the index is opt-in-by-build and a `< 50k`-file repo of ordinary
  code stays comfortably under 1 GB, but a translation-/doc-heavy 50k-file repo can exceed it.

## Honest caveats (baked into `schema.sql` + the docs)

1. **Trigram excels at literal substrings; complex regex degrades.** `searchContent` is exact
   substring only — it does not run regex. A regex caller must fall back to a verify-scan; this is
   not a regex engine.
2. **`< 3`-char patterns return nothing** — trigram cannot index them. Honest empty, not an error.
3. **~1.5× DB / ~20 KB-per-file storage** on content-dense repos (measured above). The `content`
   column stores raw bytes; that is the cost of answering content queries from the same index.
4. **Migrated existing indexes are empty until a full reindex** (`contentIndexFileCount() === 0`) —
   the raw bytes were never stored, so there is nothing to backfill in-place.
5. **Not a correctness/outcome lever.** Per Step A (`eval-results/content-vs-structural-2026-06-24/`),
   on a real LLM the content index is an adoption-gated *economy* convenience, never marketed as
   more-correct.
6. **COVERAGE GAP (found 2026-06-24 via the "no-区分度" push — `coverage-probe.mjs`):** content_fts
   is populated in `storeExtractionResult`, which runs **only for files OmniWeave EXTRACTS** — the
   recognized source languages **plus** the few config grammars it indexes (`.yaml`/`.yml`). It does
   **NOT** cover `.json`, `.md`, `.txt`, or any other non-indexed text type. Firsthand: indexing a
   dir with `locales/en.json`, `readme.md`, `app.ts`, `config.yaml`, content_fts covers only
   `app.ts` + `config.yaml`; the i18n `en.json` and the markdown are absent, so
   `searchContent("Wireframe to code")` cannot find the i18n value. **This is the symbol-UNcorrelated
   content (i18n / docs / generic JSON config) where a content index would matter MOST — and the
   current implementation does not reach it.** It diverges from the war plan's stated intent
   ("populate for files ≤ MAX_FILE_SIZE" = all files). Closing it means a content-only pass over the
   scanned file list (binary-skipped) decoupled from extraction — which raises content storage and
   pressures the `< 1 GB for < 50k files` gate on doc/translation-heavy repos. **That tension
   (coverage vs the storage gate) is a product decision, recorded here rather than silently resolved.**

## Reproduce

```bash
npm run build
# index any repo, then measure content_fts's share of the DB:
node dist/bin/omniweave.js init <repo>
node eval-results/content-fts-2026-06-24/measure-storage.mjs <repo>/.omniweave/omniweave.db
```
