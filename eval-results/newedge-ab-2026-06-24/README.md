# New-edge agent A/B — do the edges shipped this cycle actually help an agent?

**Status: RESULTS PENDING** (matrix running; verdict + tables filled on completion).

## Abstract

The 2026-06-24 cycle shipped a batch of new graph edges: the 8/8 framework-dispatch
synthesizers (celery / spring-event / mediatr / sidekiq / laravel / redux-thunk /
c-fnptr / **RTK-Query**) and same-file **`module-var-ref`**. The fixture/parity gates
proved they *exist* and hold parity with codegraph. This study answers the iron-law
question those gates do **not**: *存在 ≠ 有用* — does a real LLM agent spend fewer
Read/turns because of them, and with what honesty caveats?

This is **not** a "more correct" claim. Correctness is expected to tie across every arm
(it does — see results). The question is purely **effort** and **trust honesty**, run
fail-closed with tie/no-help/ceiling questions included to defeat cherry-picking.

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
  `valid:false`; invalid runs are never scored as wins (`ab-benchmark.sh`).
- **Grading**: per-question keyword predicate over the lowercased answer
  (`score-benchmark.mjs` `GRADERS['NE-*']`), GT locked + line-cited in
  `datasets/MANIFEST.md`, each verified by reading the real source AND confirming the
  edge fires (`omniweave init` + DB query).
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

_(filled on matrix completion — scored table + per-question honest verdict from
`score-benchmark.mjs`, raw `results.jsonl` committed under `results/`.)_

### Early read (Q1 NE-rtk-hook complete, Q2 NE-pinia-login forced cells)

- Correctness ties (16/16 on rtk, 5/5 on pinia-forced so far).
- **Natural mode: 0 MCP adoption across all arms** (omniweave, codegraph *and* grep all
  `mcp=0` — MiMo greps/reads regardless of attached tools), reproducing Step A's 0/36.
- **Forced mode: omniweave = codegraph** (both answer via ~1 MCP call) — parity confirmed
  (the debt is closed), sufficiency confirmed.
- Even the "discriminating" rtk baseUrl question ties on effort: a 16-line fixture lets
  grep read the whole file, so the structural edge's convention-free jump shows no
  effort delta at that scale.

## Honest verdict (provisional, pending full matrix)

The new edges are **validated as present, usable (forced-mode sufficiency), and at parity
with codegraph (no regression)** — but this A/B does **not** demonstrate an
effort moat *over grep* for them on these targets with this driver, because (a) MiMo does
not adopt the structural MCP in natural mode and (b) the dispatch fixtures are small
enough that grep+read ties. This is consistent with rounds 1–7 and Step A: correctness is
not the moat; the measured effort moat lives on *large cross-boundary* questions, not
small same-language dispatch links. **No "more correct" claim; ties reported as ties.**
