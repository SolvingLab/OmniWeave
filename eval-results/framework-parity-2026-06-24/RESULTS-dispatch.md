# Dispatch-synthesizer parity — Celery / Spring / MediatR / Sidekiq / Laravel

**Date:** 2026-06-24 · **Question:** does OmniWeave still emit *fewer* edges than
codegraph (CG) on apps that use the five cross-boundary dispatch frameworks CG had a
synthesizer for and OmniWeave did not? Iron-law-6 says a superset fork must never be
weaker. This is the red→green record of closing that half of the framework debt.

## Background — the gap that was real

CG's `callback-synthesizer.ts` aggregator called eight framework synthesizers OmniWeave's
did not: `celeryDispatchEdges`, `springEventEdges`, `mediatrDispatchEdges`,
`sidekiqDispatchEdges`, `laravelEventEdges`, `reduxThunkEdges`, `rtkQueryEdges`,
`cFnPointerDispatchEdges`. On a Celery/Spring/.NET-MediatR/Sidekiq/Laravel app, CG bridged
the runtime dispatch (`.delay()`, `publishEvent`, `_mediator.Send`, `.perform_async`,
`event(new X)`) to its handler; OmniWeave emitted **zero** such edges, so its graph was
strictly poorer. (OmniWeave is *richer* than CG on its own axes — R-S4 dispatch, the four
bridge edge kinds `crossLang/produces/consumes/invokes`, Zustand, SvelteKit, RN/Fabric — so
the two have *diverged*: each had synthesizers the other lacked. Iron-law-6 is about not
being *weaker*, so the CG-only synthesizers are a genuine debt regardless of the OW-only wins.)

## Method (fail-closed, reproducible)

Five minimal **real-idiom** fixtures, one per framework, each exercising the genuine
dispatch pattern the synthesizer targets (checked in under `dispatch-fixtures/`). Each is
indexed by **both** engines and the edge tables are compared by
`measure-dispatch.mjs` — fail-closed: a missing DB, a query error, or `OW < CG` on **any**
fixture exits non-zero; the PASS line only prints when every fixture verifies
`OW.fw ≥ CG.fw ≥ 1` **and** `OW.total ≥ CG.total`.

| fixture | language | idiom (the runtime hop static parsing misses) | ground-truth bridge |
|---|---|---|---|
| `celery`  | Python | `@shared_task def send_welcome_email` ← `send_welcome_email.delay(...)` | `signup → send_welcome_email` |
| `spring`  | Java   | `publisher.publishEvent(new OrderPlaced(...))` → `@EventListener onOrderPlaced(OrderPlaced)` | `placeOrder → onOrderPlaced` |
| `mediatr` | C#     | `_mediator.Send(new CancelOrderCommand(...))` → `IRequestHandler<CancelOrderCommand>.Handle` | `Cancel → Handle` |
| `sidekiq` | Ruby   | `DestroyUserWorker.perform_async(...)` → `class DestroyUserWorker; include Sidekiq::Worker; def perform` | `destroy → perform` |
| `laravel` | PHP    | `event(new PlaybackStarted(...))` → listener `handle(PlaybackStarted $e)` | `play → handle` |

Reproduce:

```bash
npm run build
node eval-results/framework-parity-2026-06-24/measure-dispatch.mjs
```

## Result — debt CLOSED, parity (not superiority)

```
framework  | synthesizedBy     | OW fw | CG fw | OW total | CG total | OW>=CG
-----------|-------------------|-------|-------|----------|----------|-------
celery     | celery-dispatch   | 1     | 1     | 8        | 8        | YES
spring     | spring-event      | 1     | 1     | 19       | 19       | YES
mediatr    | mediatr-dispatch  | 1     | 1     | 19       | 19       | YES
sidekiq    | sidekiq-dispatch  | 1     | 1     | 6        | 6        | YES
laravel    | laravel-event     | 1     | 1     | 19       | 19       | YES
PASS: all 5 fixtures verified OmniWeave >= codegraph.
```

Each framework: OmniWeave now emits the **same** dispatch bridge edge as CG and the **same
total** edge count. The debt for these five is closed — OmniWeave is no longer weaker.

## Honesty

- **This is a tie, not a win.** The claim is *parity* (iron-law-6: not weaker), never
  "more correct". Both engines connect the same dispatch; OmniWeave merely stopped being
  behind. The synthesized edge is the same `source→target` pair on both.
- **OmniWeave's edges carry a trust marker CG's do not.** Every bridge is
  `provenance:'heuristic'` with `metadata.synthesizedBy` + a `confidence` (0.8 for
  celery/spring/mediatr/laravel, 0.85 for sidekiq's mixin-gated worker resolution) +
  `registeredAt`. These are *inferences* keyed by name/type with precision gates (a celery
  task must carry the decorator; a sidekiq receiver must `include Sidekiq::Worker`; a
  mediatr receiver must be mediator-ish AND resolve to a known handler type), never proven
  structural edges. Wrong-edge-worse-than-missing: ambiguous cross-module collisions bail.
- **Scope is the declared idiom, not the whole framework.** ActiveJob's `perform_later`,
  MediatR pipeline behaviors, queued Laravel jobs, and runtime-string event names are out
  of scope by construction — they yield 0, not a guess.
- **Remaining CG-only synthesizers** (`rtkQueryEdges`, `cFnPointerDispatchEdges`) are
  tracked separately; redux-thunk is already closed (committed) and stricter than CG's
  (it requires the dispatched name to resolve to a thunk constant, not any same-named
  callable — precision over CG's `cands[0]` fallback).

Behavior is locked by `__tests__/framework-dispatch-synthesizer.test.ts` (one assertion per
framework + a redux precision negative-case).
