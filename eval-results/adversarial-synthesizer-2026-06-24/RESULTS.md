# Adversarial false-positive battery — do the dispatch synthesizers fabricate edges under hostile input?

**Date:** 2026-06-24 · **Posture:** challenge OmniWeave's *own* advantage. The cross-boundary
dispatch synthesizers (celery / sidekiq / mediatr / redux-thunk / c-fnptr / crossLang) are a
differentiator — so stress them with inputs *designed to trick the precision gate into emitting a
wrong edge*. 错边比漏边: a fabricated dispatch edge is worse than a missing one. Don't trust the
gates — prove them. Fail-closed harness: any fabricated edge exits non-zero.

## The six traps (each must emit ZERO of its forbidden edge)

| trap | hostile input (looks like a dispatch, isn't) | gate that must refuse it |
|---|---|---|
| celery | `send_email.delay(r)` where `send_email` has **no** `@shared_task`/`@app.task` | decorator gate |
| sidekiq | `PlainClass.perform_async(u)` where `PlainClass` does **not** `include Sidekiq::Worker` | mixin gate |
| mediatr | `httpClient.Send(x)` (non-mediator receiver) even though a real `IRequestHandler<FooCommand>` exists | receiver-is-mediator gate |
| redux-thunk | `dispatch(fetchUser(1))` where `fetchUser` is an **ordinary function**, not a thunk constant | thunk-constant-target gate |
| c-fnptr | `struct ops` defined in **two unrelated TUs** (no shared header); `run_a` (a.c) must not wire to `handler_b` (b.c) | visible-struct-definition gate |
| crossLang | `subprocess.run(["Rscript", f"{name}.R"])` — a **runtime-computed** path | `{}`/`$` runtime-path skip |

## Result — 6/6 PASS, zero fabricated edges

```
✓ PASS [celery]    no false celery-dispatch edge
✓ PASS [sidekiq]   no false sidekiq-dispatch edge
✓ PASS [mediatr]   no false mediatr-dispatch edge
✓ PASS [redux]     no false redux-thunk edge
✓ PASS [cfnptr]    no false fn-pointer-dispatch edge   (run_a→handler_b = 0; the only edge is the
                                                         correct intra-TU run_a→handler_a)
✓ PASS [crosslang] no false cross edge
PASS: 6/6 — every precision gate refused the hostile input (0 fabricated edges).
```

Every gate held under input specifically built to break it. The c-fnptr trap is the sharpest: a
same-named `struct ops` in two translation units is exactly the cross-wire a name-keyed bridge
would fall for — OmniWeave keys on the *visible struct definition*, emits only the correct
intra-TU `run_a → handler_a`, and refuses the cross-TU `run_a → handler_b`.

## Honesty

- This proves **precision (no false positives)**, not recall. These traps are *true negatives* the
  gates correctly refuse — they say nothing about edges the synthesizers should emit and don't.
  Recall is covered by the positive fixtures in `framework-parity-2026-06-24/` (every synthesizer
  emits the correct edge on a real-idiom app) and the unit tests.
- No "more correct than CG" claim. CG's own synthesizers have comparable gates; this is OmniWeave
  holding its own line, not beating CG. The value is *trust*: a synthesized `calls` edge marked
  `heuristic` + `confidence` is only useful if it is not silently wrong, and under adversarial
  input it is not.

## Reproduce

```bash
npm run build
OW=dist/bin/omniweave.js node eval-results/adversarial-synthesizer-2026-06-24/probe-false-positives.mjs
```
