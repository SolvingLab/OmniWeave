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

## Result 1 — vue-realworld (Pinia options-form): **OW is WEAKER (debt OPEN)**

Measured with OmniWeave at build `9571c2e3a19f` (includes the parallel-stream commit `14ecd5a`
"conservative store dispatch bridges"):

| metric | OmniWeave | codegraph | ⑥ |
|---|---|---|---|
| total nodes | 316 | 342 | **OW WEAKER** |
| function+method nodes | 45 | 71 | **OW WEAKER (−26)** |
| **store-file fn/method nodes** | **1** | **27** | **OW WEAKER (−26)** |
| **edges synthesizedBy=pinia-store** | **0** | **25** | **OW WEAKER** |
| edges synthesizedBy=vue-handler | 17 | 17 | OK |
| edges synthesizedBy=jsx-render | 2 | 2 | OK |

**Root cause (two-layered debt; the synthesizer-only fix is inert here).** The Pinia
*options* store defines its actions as object-literal methods — `defineStore('auth', { actions:
{ setAuth(){…}, login(){…} } })`. codegraph **extracts** those as `function` nodes (its
`tree-sitter.ts` has `looksLikeVueStoreFile` + `findVueStoreCollectionObjects` +
`extractStoreCollectionMethods` + `findPiniaSetupFn`/`extractPiniaSetupBody`), so its
pinia-store synthesizer has 25 targets to bridge. OmniWeave does **not** extract object-literal
store members (only 1 store-file fn node vs 27), so the conservative pinia-store bridge committed
in `14ecd5a` finds **0** targets and emits **0** edges. **Closing ⑥ here requires the
extraction-layer port, not just the synthesizer.** (Firsthand confirmation: indexing the lone
fixture `defineStore('user',{actions:{login(){…}}})`, codegraph emits `function login` +
`function refresh`; OmniWeave emits only the `useUserStore` constant.)

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

The ⑥ debt is **real and concentrated in the Pinia options-form extraction gap**: −26 store
nodes, **0 vs 25 pinia-store edges** on a real Vue app. The next action is the extraction-layer
port (object-literal store-member extraction) into `src/extraction/tree-sitter.ts`, after which
the already-committed pinia-store synthesizer will have targets — then re-run this harness to
confirm OW ≥ CG, and `lang-parity.sh` on the 14 single-language repos to confirm no regression.

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
