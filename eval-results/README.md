# `eval-results/` — evaluation & evidence artifacts (authoritative index)

This directory holds every **reproducible evidence artifact** behind OmniWeave's claims:
agent A/B benchmarks, cross-language parity, framework-synthesizer parity, adversarial
batteries, and the design-decision records that say *why* a thing was built, deferred, or
rejected. Each artifact is a self-contained, dated folder; raw transcripts and working
DBs are committed (or gitignored when huge) so any number can be re-derived.

Discipline (applies to every artifact here): **no "more correct" claim; ties reported as
ties; harnesses fail-closed; ground truth is line-cited and human-verifiable.** An
artifact that cannot be reproduced or whose verdict is cherry-picked does not belong here.

## Index (chronological within topic)

| Artifact folder | Date | Topic | Entry doc | Honest verdict / status |
|---|---|---|---|---|
| `agent-ab-2026-06-13/` | 06-13→14 | Agent A/B rounds 1–6 (with/without, vs LSP/Aider) | `RESULTS.md` | Correctness ties grep everywhere; moat = effort/token, scales with repo size + weaker models |
| `agent-ab-2026-06-23/` | 06-23 | Round 7 — output-honesty isolation (same index, pre/post) | `RESULTS.md` | Hardening removed 24K competitor-snapshot leak; snapshot-suppression is fixing OW, not beating grep |
| `agent-ab-2026-06-24/` | 06-24 | Structural capability matrix + GT manifests (vs-codegraph support) | `RESULTS.md` | Structural edge-count evidence; not an agent win until transcripts exist |
| `vs-codegraph-2026-06-24/` | 06-24 | Head-to-head vs upstream codegraph 1.0.1 | `RESULTS.md` | Differentiators = 4 bridge edge kinds + S4 dispatch graph; not "more correct" (parse parity) |
| `omniweave-benchmark/` | 06-24 | Publication-grade multi-language benchmark (Parts A/B/C, 66 runs) | `README.md` | 14-lang parity + bridge-edge differentiation + agent A/B; correctness ties, moat = effort on cross-boundary |
| `content-vs-structural-2026-06-24/` | 06-24 | Step A — is `content_fts` an outcome or economy win? | `README.md` | Economy not outcome (MiMo 0/36 MCP adoption); 60–70% economy route, never marketed as more-correct |
| `content-fts-2026-06-24/` | 06-24 | Raw-content trigram index foundation | `README.md` | The one new general lever (`pattern:` search); storage 1.49×; adoption-gated economy |
| `framework-parity-2026-06-24/` | 06-24 | Framework dispatch-synthesizer parity (8/8) | `RESULTS-dispatch.md` | dispatch-parity 6/6 OW≥CG (a TIE, not a win); `dispatch-fixtures/` are the controlled gate |
| `adversarial-synthesizer-2026-06-24/` | 06-24 | False-positive battery (6 traps designed to fool synthesizers) | `RESULTS.md` | 6/6 PASS — zero fabricated edges; precision under hostile input |
| `lang-parity-2026-06-24/` | 06-24 | Cross-language node/edge parity vs codegraph (full 14) | `RESULTS-full14-2026-06-24.md` | Structural edges OW≥CG on all 14 (TS calls +34); deficit is `references`-only (CG-liberal/OW-precise); Swift/Kotlin gaps closed |
| `spec-audit-2026-06-24/` | 06-24 | 工程交付强制规范 §0–§10 audit (56 invariants) | `RESULTS.md` | 48 PASS / 5 PARTIAL / 3 FAIL → all actionable findings fixed red→green |
| `raison-detre-2026-06-24/` | 06-24 | Existential verdict — is there a defensible general moat? | `README.md` + `debate.md` | Niche fork, no defensible *general* moat; S4 dispatch is the one scale-invariant delta |
| `general-moat-2026-06-24/` | 06-24 | General-moat ambition + framework-synthesizer gap scan | `README.md` | Strategy doc for the "fusion (content+structure+bridge+honest)" bet |
| `value-ref-decision-2026-06-24/` | 06-24 | Same-language value-reference edge — decision | `README.md` | DEFERRED (tested patch preserved); needs cross-language A/B before entering the trust boundary |
| `step-d-2026-06-24/` | 06-24 | Step D output economy — disposition | `DECISION.md` | D1 landed (callers/callees trust labels) + D2 verified + D3 (metadata-only) rejected as form-tax |
| `refactor-debt-2026-06-24/` | 06-24 | Refactor-debt evaluation (callback-synth split / dedup key / minified index) | `DECISION.md` | All three DEFER/KEEP with evidence — zero agent/output gain for real risk |
| `newedge-ab-2026-06-24/` | 06-24 | New-edge agent A/B (dispatch + rtkQuery + module-var-ref) | `README.md` | 82 runs/0 INVALID: correctness ties, 0 natural MCP adoption, forced OW=CG parity → present+usable but **no grep-effort moat** (parity-restoration, not a moat) |

## Convention (规章 — what a well-formed artifact looks like)

1. **Folder name**: `<topic>-YYYY-MM-DD/`, kebab-case, dated. The date is the folder's;
   **files inside MUST NOT repeat it** (`RESULTS.md`, not `RESULTS-2026-06-24.md`).
2. **One canonical entry doc per artifact**, named by intent: `RESULTS.md` (measurement),
   `DECISION.md` (a build/defer/reject decision), or `README.md` (a multi-part artifact
   with `datasets/`/`questions/`/`harness/`/`results/` subdirs, e.g. `omniweave-benchmark/`,
   `newedge-ab-2026-06-24/`). Pick one; do not ship `RESULTS.md` + `README.md` for the
   same thing.
3. **Big artifacts use the four-subdir layout**: `datasets/` (MANIFEST + fetch), `questions/`
   (GT-locked bank), `harness/` (fail-closed runner + scorer), `results/` (raw transcripts +
   scored). Working dirs (`.bench-out*`, `.parity-out`) stay **gitignored**.
4. **Honesty header** in every entry doc: state the claim being tested and that it is not a
   correctness claim; include tie/no-help/ceiling cases.

## Deferred housekeeping (needs a quiescent repo — see note)

These naming fixes are **intentionally not applied yet** because a concurrent work-stream
was committing to this repo every few minutes during this session (rebuilds, wide
`git add`, edits to `CHECKPOINT.md` + active artifact dirs). Renaming now would break the
1–5 cross-references each path has in `CHECKPOINT.md` / `README.md` / `NEXT-SESSION-*.md` /
`CLAUDE.md`↔`AGENTS.md` (the last two are sync-locked) and collide with the active commits.
Apply once the repo is quiescent:

- `lang-parity-2026-06-24/`: drop the redundant inner date — `RESULTS-full14-2026-06-24.md`
  → `RESULTS-full14.md`, `parity-full14-2026-06-24.jsonl` → `parity-full14.jsonl`,
  `per-kind-decomposition-2026-06-24.json` → `per-kind-decomposition.json` (+ update the one
  `CHECKPOINT.md` reference).
- `framework-parity-2026-06-24/`: it has both `RESULTS.md` and `RESULTS-dispatch.md` +
  `measure.mjs`/`measure-dispatch.mjs` — fine as two distinct measurements (Pinia/Vuex vs
  dispatch), but cross-link them from one entry doc.
- Root `NEXT-SESSION-*.md`: **DONE this session** — collapsed four competing handoffs to the
  one `NEXT-SESSION-GENERAL-MOAT.md` (self-declared sole authority); the three superseded
  earlier-loop handoffs (`-AUDIT-AND-PROOF`, `-GOAL`, `-OW-RAISON-DETRE`) were removed (their
  substance lives in `spec-audit-*`/`raison-detre-*`, and git preserves the originals), and the
  lone `value-ref-decision/README.md` citation was de-pointed.
