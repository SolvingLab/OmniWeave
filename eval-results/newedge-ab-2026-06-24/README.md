# New-edge agent A/B — do the edges shipped this cycle actually help an agent?

**Status: COMPLETE** — 82/82 runs finished, 0 harness-invalid runs; strict scored
artifacts are committed under `results/`.

## Abstract

The 2026-06-24 cycle shipped a batch of new graph edges: the 8/8 framework-dispatch
synthesizers (celery / spring-event / mediatr / sidekiq / laravel / redux-thunk /
c-fnptr / **RTK-Query**) and same-file **`module-var-ref`**. The fixture/parity gates
proved they *exist* and hold parity with codegraph. This study answers the iron-law
question those gates do **not**: *存在 ≠ 有用* — does a real LLM agent spend fewer
Read/turns because of them, and with what honesty caveats?

This is **not** a "more correct" claim. The question is **effort**, **tool adoption**,
and **trust honesty**, run fail-closed with tie/no-help questions included to defeat
cherry-picking. Correctness differences are reported only as observed run outcomes.

## Method (publication-grade, reproducible)

- **Driver**: real LLM — MiMo `mimo-v2.5-pro` (and `mimo-v2.5` "small" on the headline
  forced cells), via `claude -p --output-format stream-json`, `--max-budget-usd 3`,
  240 s/cell. Keys read from the environment only; never written to disk/log.
- **Arms**: `omniweave` (this checkout's MCP), `codegraph` (upstream `1.0.1` `a893156`
  MCP), `grep` (no MCP — shell only).
- **Modes**:
  - *natural* — shell allowed → measures whether the agent **adopts** the structural MCP.
  - *forced* — `force-mcp-hook.sh` denies Bash/Grep/Glob + source-file Reads → measures
    whether the MCP, once it is the only option, can **answer** (tool sufficiency). This
    is where an edge one tool has becomes a measurable answer/effort delta.
- **Matrix** (per differentiation question): forced `omniweave`×3 + `codegraph`×3 (pro),
  + ×2 each (small); natural `omniweave`×2 + `codegraph`×2 + `grep`×2 (pro). Tie/no-help
  questions: natural `omniweave`×3 + `grep`×3 (pro).
- **Fail-closed**: any claude failure / empty jsonl / missing result marks the run
  `valid:false`; invalid runs are never scored as wins, and current harness/scorer exits
  non-zero for invalid, empty, ungraded, or incomplete matrices.
- **Grading**: per-question predicate over normalized answer text
  (`score-benchmark.mjs` `GRADERS['NE-*']`), GT locked + line-cited in
  `datasets/MANIFEST.md`, each verified by reading the real source AND confirming the
  edge fires (`omniweave init` + DB query). Path graders use exact path matching and
  simple negation guards; raw transcripts remain available for human audit.
- **Targets**: 5, in `datasets/MANIFEST.md` — 2 real repos (vue-realworld pinia;
  psf/requests `d64b9ad`), 3 controlled real-idiom fixtures (rtk / celery / sidekiq),
  the same status the `capstone`/`polyglot` eval-gate fixtures hold.
- **Isolation**: run from a detached `git worktree` at the pinned commit with its own
  built `dist`, because a concurrent work-stream was rebuilding the live `dist`
  mid-session (caveat: a moving `dist` under a running A/B silently contaminates it).

## Question bank (7 — see `questions/benchmark-questions-newedge.json`)

| id | type | target | new edge | GT |
|---|---|---|---|---|
| NE-rtk-hook | differentiation | rtk | RTK-Query hook→createApi (+module-var-ref) | `/api` (baseUrl, arbitrary config — not convention-derivable) |
| NE-pinia-login | differentiation | vue-realworld (real) | pinia component-handler→store action | `src/store/auth.js` |
| NE-sidekiq-worker | differentiation | sidekiq | perform_async→worker perform | `DestroyUserWorker` |
| NE-celery-task | differentiation | celery | `.delay`→task | `send_welcome_email` |
| NE-modvar-impact | honesty-tie | requests (real) | same-file module-var-ref | `check_compatibility` |
| NE-singlepoint-tie | honesty-tie | requests (real) | (none) | `src/requests/__init__.py` |
| NE-nohelp | no-help | requests (real) | (none) | "No" (negative feature) |

## Results

Full table: `results/scored.md`. Raw stream transcripts: `results/raw/transcripts/`.
Full-answer parsed runs: `results/runs.jsonl`. Strict scored rows:
`results/scored.jsonl`. Run provenance and hashes: `results/RUN-MANIFEST.md`.

### Aggregate

| arm | correct | avg MCP | avg Read | avg Grep | avg Bash | avg turns |
|---|---:|---:|---:|---:|---:|---:|
| omniweave | 37/37 | 0.9 | 0.8 | 0.3 | 1.8 | 11.9 |
| codegraph | 27/28 | 0.7 | 0.8 | 0.3 | 1.8 | 13.3 |
| grep | 16/17 | 0.0 | 0.6 | 0.1 | 0.9 | 5.7 |

### Per Question

| id | honest result |
|---|---|
| NE-rtk-hook | omniweave 7/7, codegraph 7/7, grep 2/2 |
| NE-pinia-login | omniweave 7/7, codegraph 7/7, grep 1/2 |
| NE-sidekiq-worker | omniweave 7/7, codegraph 6/7, grep 2/2 |
| NE-celery-task | omniweave 7/7, codegraph 7/7, grep 2/2 |
| NE-modvar-impact | omniweave 3/3, grep 3/3 |
| NE-singlepoint-tie | omniweave 3/3, grep 3/3 |
| NE-nohelp | omniweave 3/3, grep 3/3 |

## Honest Verdict

The new edges are **present, usable under forced MCP, and no longer a regression against
codegraph on this bank**. They do **not** demonstrate a broad effort moat over grep on
these small targets with this driver: natural mode again shows **0 MCP adoption**, and
small fixtures are cheap to inspect with shell/read. The useful signal is narrower:
OmniWeave's default surface can answer the new-edge bank fail-closed, while ties and
no-help cases stay visible. The next benchmark must move these same edge classes into
larger cross-boundary repos if we want to measure effort reduction rather than parity.
