# New-edge A/B — dataset manifest

Every target is either a **real public repo** pinned to a commit, or a **controlled
real-idiom fixture** checked into this repo (the same status the `capstone` /
`polyglot-subprocess` eval-gate fixtures already have). Targets are staged into one
`DATASETS_DIR` and pre-indexed with **both** OmniWeave (this checkout) and upstream
codegraph `1.0.1` (`a893156`) by `harness/setup-newedge-targets.sh`.

This bank exists to answer one honest question the existing benchmark never tested:
the **new edges shipped this cycle** (the 8/8 framework-dispatch synthesizers,
RTK-Query hook→endpoint, and same-file `module-var-ref`) **exist** in the graph —
but *存在 ≠ 有用*. Does an agent actually spend fewer Read/turns because of them, and
do they hold parity with codegraph (iron-law ⑥)?

## Honest framing (read before the numbers)

All of these new edges are **parity-restoration**: they brought OmniWeave back up to
codegraph, which already had equivalent synthesizers (verified: CG emits 2 synthesized
edges on the `rtk` fixture, 44 on `vue-realworld`). So the moat tested here is **NOT
"OmniWeave beats codegraph"** — it is:

1. **Structural (OW *or* CG) vs grep** on *indirect / generated-symbol* links grep
   cannot follow without framework-convention knowledge (RTK generated hooks; pinia
   component→store dispatch across files).
2. **OW = CG parity** (no regression; the debt is closed).
3. **Honest ties** where the new edge has no advantage (same-file `module-var-ref`,
   single-point definition, negative-feature) — included to defeat cherry-picking.

We never claim "more correct". Correctness is expected to tie across all arms.

## Targets

| Target | Kind | Source / commit | New edge under test | GT-verified edge |
|---|---|---|---|---|
| `rtk` | controlled fixture | `eval-results/framework-parity-2026-06-24/dispatch-fixtures/rtk` | RTK-Query generated hook → endpoint + module-var-ref hook → createApi const | `useGetRecordsQuery → getRecords` (rtk-query); `useGetRecordsQuery → recordsApi` (module-var-ref) |
| `vue-realworld` | **real repo** | gothinkster/vue-realworld-example-app `f7e48c8` (Pinia options-store port) | pinia-store component-handler → store action (cross-file) | `onSubmit → login` (`src/store/auth.js:37`) |
| `celery` | controlled fixture | `dispatch-fixtures/celery` | celery `.delay` dispatch → task | `signup → send_welcome_email` (`app/tasks.py:4`) |
| `sidekiq` | controlled fixture | `dispatch-fixtures/sidekiq` | sidekiq `perform_async` → worker `perform` (cross-file) | `destroy → perform` (`app/destroy_user_worker.rb:3`, via `DestroyUserWorker`) |
| `requests` | **real repo** | psf/requests `d64b9ad` (= benchmark `lang-python`) | same-file `module-var-ref` function → module constant | `check_compatibility → charset_normalizer_version` (`src/requests/__init__.py:52`) |

Re-create with: `bash harness/setup-newedge-targets.sh` (rsync clean copies into
`~/ow-newedge-targets`, then `omniweave init` + `codegraph init` each; the script exits
non-zero if any source is missing or either indexer fails). The real repos come from
`eval-results/omniweave-benchmark/datasets/fetch.sh` (vue-realworld is the gothinkster
app cloned separately; requests = `lang-python`).

## Why each differentiation question is discriminating (not reasoning-answerable)

A question is worthless if the answer can be produced from the prompt text + framework
knowledge alone (题无区分度 = 垃圾). Each was checked:

- **NE-rtk-hook** asks for the configured `baseUrl` (`/api`) — an *arbitrary config
  value* in the `createApi` body, NOT derivable from the RTK naming convention. The
  agent must reach the `recordsApi` definition (which the module-var-ref + rtk-query
  edges bridge from the generated hook). *(An earlier draft asked "which endpoint does
  the hook map to" — discarded after a pilot showed MiMo answered `getRecords` by pure
  convention with zero tools: no discrimination.)*
- **NE-pinia-login / NE-sidekiq-worker / NE-celery-task** name the dispatch site, not
  the handler; the handler/target is only in the code.
- **NE-modvar-impact / NE-singlepoint-tie** require reading the actual file.
- **NE-nohelp** is a true negative (no structural fact helps).
