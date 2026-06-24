# lang-parity: are codegraph's extra edges useful? — and if so, beat it

**Date:** 2026-06-24 · **Posture:** adversarial, agent-first. Iron-law-6 says OmniWeave (a
superset fork) must never be weaker than codegraph (CG). A `lang-parity.sh` re-run flagged
OmniWeave with FEWER standard edges than CG on real repos. The question is not "how do we make
the number go up" — it is, from a coding **agent's** perspective: *are the edges CG has and
OmniWeave lacks actually useful?* If yes, build them (beat CG). If no, OmniWeave is right to
refuse them and the metric is the thing that's wrong.

## The flag, decomposed by edge kind (aider, Python, real repo)

After excluding nothing, aider showed OW 9243 edges vs CG 9568. Drilling the −325 by kind, the
structural backbone (`contains`/`imports`/`extends`/`implements`/`decorates`) was **byte-equal**;
the entire deficit was `calls` −139, `instantiates` −18, `references` −169. Two very different
stories hid in there:

| CG-only edges | what they are | useful to an agent? | verdict |
|---|---|---|---|
| `calls`/`instantiates` (−157) | **100% target vendored MINIFIED `.js`** (`asciinema-player.min.js`; CG name-resolves single-letter minified calls like `g(...)` / `[Symbol.iterator]→g` to coincidental same-name fns) | **No.** An agent never traverses a minified bundle's call graph. | **CG false positives — OmniWeave correctly refuses (错边比漏边).** |
| `references` to `variable`/`constant` (−169, all same-file, all Python) | a function/method body (or another module-var's initializer) **uses a module-level constant/variable** by name | **Yes.** "Which functions use this config constant?" is a core impact-analysis query before changing a shared value. | **A real gap — OmniWeave must have it. Beat CG.** |

OmniWeave's 60 references were exactly CG's references-to-*callables/types* subset (60 = 60,
identical); the only delta was references to *value* symbols, which OmniWeave's extractor scoped
out (it records references to TYPES only — param/return/field).

## The fix — synthesize the useful edges, at higher precision than CG

`moduleVarReferenceEdges` (a same-file resolver pass): for each module-level `variable`/`constant`
V in a file, link every function/method/var whose body uses V's name → V. Tighter than CG's raw
text match — comment/string stripped, word-boundary, the name dropped if it is re-declared /
assigned / parameter-bound / for-loop-bound in the source (shadowing → the use is the local), and
dropped if shared with a function/class in the file (ambiguous). Heuristic + confidence 0.8.

Adversarially verified (`__tests__/module-var-ref-synthesizer.test.ts`): real uses captured
(incl. `range(MAX_RETRIES)` as a call argument); **zero** fabricated references from a shadowed
param, a local re-declaration, a string-only mention, or a cross-file name. CG, by contrast,
emits some bidirectionally-symmetric (`X↔Y`) reference pairs — the signature of "co-mentioned",
not a directed reference. OmniWeave is directed and shadow-aware: more precise.

## Result — OmniWeave is now a true superset (fresh full index, OmniWeave vs CG)

```
repo                 | OW raw | CG raw | OW first-party | CG first-party | first-party Δ | OW≥CG?
---------------------|--------|--------|----------------|----------------|---------------|-------
aider                | 9426   | 9568   | 8357           | 8347           | +10           | YES
code-graph-mcp       | 1281   | 1215   | 1281           | 1215           | +66           | YES
semantic-search-mcp  | 1048   | 1021   | 1048           | 1021           | +27           | YES
```

- **First-party (the fair metric — excludes vendored/minified bundles both tools mishandle):
  OmniWeave ≥ CG on every repo.** `lang-parity.sh` now reports `ow_edges_fp`/`cg_edges_fp`/`fp_diff`
  for exactly this reason; raw is kept alongside so nothing is hidden.
- **Raw: OmniWeave now BEATS CG on the two clean repos** (code-graph-mcp 1281>1215,
  semantic-search-mcp 1048>1021) — repos with no vendored minified bundle. The module-var
  references that previously made OmniWeave *trail* now put it *ahead*.
- **aider raw −142 is isolated to one vendored file** (`asciinema-player.min.js`): CG's
  false-positive resolution of its minified single-letter calls. Matching that count would mean
  OmniWeave fabricating the same false edges — a direct iron-law-6/错边比漏边 contradiction, and
  by the agent-usefulness test above, pure noise. OmniWeave refuses, by design.

## Honesty

- **No "more correct" claim.** Both engines parse the same code. The references are real
  dependencies CG also surfaces; OmniWeave now surfaces them too, directed + shadow-aware. The
  minified `calls` CG surfaces and OmniWeave doesn't are CG's, and they are wrong.
- **What changed vs the earlier drill-down in this folder:** the first pass concluded the deficit
  was CG looseness and stopped at "OmniWeave is not weaker". That under-delivered — half the
  deficit (the references) was *useful* and OmniWeave genuinely lacked it. This pass builds it, so
  OmniWeave is not merely "not weaker" but a real superset on first-party code.

## Reproduce

```bash
npm run build
# clear any stale in-place index first (init no-ops on an unchanged source tree even after a rebuild):
rm -rf <repo>/.omniweave <repo>/.codegraph
CGBIN=research/2026-06-23-codegraph-ecosystem/repos/codegraph/dist/bin/codegraph.js \
  bash scripts/agent-eval/lang-parity.sh <aider-dir> <code-graph-mcp-dir> <semantic-search-mcp-dir>
# read ow_edges_fp / cg_edges_fp / fp_diff in the emitted JSON (and ./parity-raw.jsonl)
```
