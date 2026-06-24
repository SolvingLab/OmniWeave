# Framework-app parity — does OmniWeave stay ≥ codegraph on real framework apps?

**Date:** 2026-06-24 · **iron-law ⑥** ("OW 绝不该弱于 CG; superset fork 起码平局") ·
`measure.mjs` / `run.sh` on real, pinned apps, indexed by both tools.

> **Why this exists.** `general-moat-2026-06-24/framework-synthesizer-gap.txt` grepped CG's
> synthesizer *function names* in OmniWeave and found 0 — but a name-match is not a
> capability-match. This measures the actual node/edge counts on **real framework apps** to
> see where (and whether) OmniWeave is genuinely weaker. It is also the gate for any Step B
> port: red (OW < CG) → port; green (OW ≥ CG) → done.

## Corpus

| App | Commit | Stack | Dispatch idiom under test |
|---|---|---|---|
| [gothinkster/vue-realworld-example-app](https://github.com/gothinkster/vue-realworld-example-app) | `f7e48c8` | Vue 3 + **Pinia (options form)** | `defineStore('x',{actions:{login(){…}}})` + `useXStore().login()` |
| [gothinkster/react-redux-realworld-example-app](https://github.com/gothinkster/react-redux-realworld-example-app) | `ee72eba` | React + **Redux** | `dispatch(thunk())` |

## Result 1 — vue-realworld (Pinia options-form): extraction half CLOSED; synthesizer half OPEN

### Before the extraction port (build `9571c2e3a19f`, with parallel-stream `14ecd5a`)

| metric | OmniWeave | codegraph | ⑥ |
|---|---|---|---|
| total nodes | 316 | 342 | **OW WEAKER** |
| function+method nodes | 45 | 71 | **OW WEAKER (−26)** |
| **store-file fn/method nodes** | **1** | **27** | **OW WEAKER (−26)** |
| **edges synthesizedBy=pinia-store** | **0** | **25** | **OW WEAKER** |
| edges synthesizedBy=vue-handler | 17 | 17 | OK |

**Two-layered root cause.** The Pinia *options* store defines actions as object-literal methods
`defineStore('auth', { actions: { setAuth(){…}, login(){…} } })`. codegraph **extracts** those as
`function` nodes, so its pinia-store synthesizer has 25 targets. OmniWeave extracted only 1
store-file fn node, so the conservative pinia-store bridge (`14ecd5a`) had **0** targets → 0 edges.

### After the extraction port (build `748427e5b063`, commit `38636ed`)

| metric | OmniWeave | codegraph | ⑥ |
|---|---|---|---|
| total nodes | **342** | 342 | **OK** |
| function+method nodes | **71** | 71 | **OK** |
| **store-file fn/method nodes** | **27** | 27 | **OK** |
| edges synthesizedBy=pinia-store | **0** | 25 | **still OW WEAKER** |
| edges synthesizedBy=vue-handler | 17 | 17 | OK |

**Extraction half is closed** — OmniWeave now extracts all 27 store-action nodes (Pinia options +
setup + Vuex-module forms; `38636ed`, locked by `store-collection-extraction.test.ts`). The 27
targets the pinia-store bridge needs now exist.

**The remaining 0-vs-25 EDGE gap is the SYNTHESIZER, not extraction — and it is the parallel
stream's `callback-synthesizer.ts`.** Diagnosis: vue-realworld dispatches are real
(`Login.vue`: `import { useAuthStore } from "@/store/auth"` → `const authStore = useAuthStore()`
→ `authStore.login({…})`). codegraph's name-based factory→store-file mapping (precise via the
store-file gate) catches all 25. The parallel stream's conservative `piniaStoreEdges` gates on
`visiblePiniaFactories`, which resolves the factory import via `resolveRelativeJsImport`
(**relative-only**) — it cannot resolve the `@/` path alias, so the factory is "not visible" and
**0 edges** are emitted. The dispatches are genuine, so this is missed recall, not avoided
false positives. **Closing it needs the synthesizer's import resolution to handle path aliases
(`@/` → indexed store file, by tsconfig paths or suffix-match), or a globally-unique-factory-name
fallback** — done within the parallel stream's precision apparatus (`isPiniaActionTarget` /
masking gates preserved), not by reverting to the looser name-based bind. Left to that stream /
a coordinated change rather than unilaterally relaxing its false-positive guards here.

## Result 2 — react-redux-realworld: **OW ≈ CG (no material gap)**

| metric | OmniWeave | codegraph | ⑥ |
|---|---|---|---|
| total nodes | 364 | 349 | OK |
| function+method nodes | 87 | 87 | OK |
| store-file fn/method nodes | 1 | 1 | OK |
| total edges | 684 | 689 | −5 (minor standard-edge drift, < the documented ≤7 long-tail) |
| edges synthesizedBy=jsx-render | 27 | 27 | OK |
| edges synthesizedBy=react-render | 3 | 3 | OK |

This classic-Redux app exercises no object-literal store collections, so neither tool's store
extraction fires and they tie on the store surface. The −5 total-edge drift is standard-edge
long-tail, not a framework-dispatch gap.

## Verdict

The ⑥ debt was **real and concentrated in the Pinia options-form gap**, and it is **two-layered**:

1. **Extraction (CLOSED, `38636ed`):** OmniWeave now extracts object-literal store members for all
   three real-world shapes (Pinia options / Pinia setup / Vuex module). On vue-realworld this took
   store-fn nodes 1→27, function nodes 45→71, total nodes 316→342 — all now **== codegraph**. No
   regression: `store-collection-extraction.test.ts` (4), `extraction.test.ts` (378), frameworks /
   frameworks-integration / closure-collection / vue-template (122), eval capstone 10/10.

2. **Synthesizer (OPEN, parallel stream's file):** the pinia-store dispatch bridge still emits
   0 vs 25 edges because `visiblePiniaFactories` resolves the factory import relative-only and
   rejects the `@/` path alias vue-realworld uses. The dispatches are genuine, so this is missed
   recall. The fix lives in `callback-synthesizer.ts` (alias-aware import resolution or a
   unique-factory fallback, inside the existing precision gates) and is left to that stream /
   a coordinated change — not closed here, to avoid unilaterally relaxing its false-positive guards.

react-redux-realworld stays at parity (Result 2 unchanged), so no Redux work is implied by this.

**Honest status line:** ⑥ extraction debt repaid and verified; ⑥ pinia-store *edge* debt diagnosed
to a one-helper alias-resolution gap and handed off, not yet repaid.

## Reproduce

```bash
# fetch the apps (not vendored)
git clone --filter=blob:none https://github.com/gothinkster/vue-realworld-example-app && \
  git -C vue-realworld-example-app checkout f7e48c8
git clone --filter=blob:none https://github.com/gothinkster/react-redux-realworld-example-app && \
  git -C react-redux-realworld-example-app checkout ee72eba
npm run build            # OmniWeave repo
eval-results/framework-parity-2026-06-24/run.sh <vue-realworld-dir> vue-realworld-pinia
eval-results/framework-parity-2026-06-24/run.sh <react-redux-dir>  react-redux-realworld
```
