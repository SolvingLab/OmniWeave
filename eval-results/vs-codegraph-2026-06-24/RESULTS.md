# OmniWeave vs upstream codegraph — head-to-head capability matrix (2026-06-24)

**What this is**: a reproducible, source-and-graph-grounded comparison of OmniWeave against its fork base, **`@colbymchenry/codegraph@1.0.1`** (snapshot `a893156`, checked into `research/2026-06-23-codegraph-ecosystem/repos/codegraph`). Both tools were **built and run** on the **same fixtures**; the comparison is over the resulting SQLite graphs and real CLI output, not claims.

**Honesty frame (unchanged moat doctrine)**: OmniWeave is **not** "more correct" than codegraph. Both parse R, TypeScript, Python, Go, etc. with the same tree-sitter machinery and resolve the same standard edges. The difference is **reachability**: OmniWeave adds edge *types* and a dispatch graph that let an agent traverse cross-boundary and S4-dispatch relationships codegraph's graph **cannot represent at all**. The value is effort/trust/traversability, not answer correctness.

## ⚠️ Honest correction to prior notes

Earlier project memory and the next-session plan said codegraph has **"no R"**. **That is stale and now false.** This codegraph snapshot ships `src/extraction/languages/r.ts` (functions, `setClass`/`R6Class`/`setRefClass`, `setGeneric`/`setMethod`, imports, call edges). **R extraction is no longer a differentiator.** What remains a differentiator is what codegraph does *with* `setMethod` (see S4 row) and the four cross-boundary edge kinds it has no type for.

## Capability matrix (evidence-backed)

| Capability | codegraph 1.0.1 | OmniWeave | Hard evidence |
|---|---|---|---|
| Standard edge kinds | 12 (`contains`…`decorates`) | 16 | `src/types.ts` both; codegraph CLAUDE.md lists 12 |
| **Cross-boundary edge kinds** `crossLang`/`produces`/`consumes`/`invokes` | **0 — no such kinds** | **4** | `rg "crossLang\|produces\|consumes\|invokes" codegraph/src/types.ts` → none |
| R extraction (functions, classes, S4 methods as nodes) | ✅ | ✅ | both ship `languages/r.ts` |
| **S4 dispatch graph** (method node + `Class::generic` + `overrides` edge) | ❌ — `setMethod` collapses to a bare `function` node named after the generic | ✅ — `method` node, `Class::generic` qualified name, `overrides` edge | empirical, below |
| **Cross-process / cross-language flow** (subprocess / `os.system` / `child_process` / `exec.Command` / `Rscript`) | ❌ — no edge type to hold it | ✅ — `crossLang`, heuristic + confidence | empirical, below |
| **Workflow DAG** (Snakemake/Nextflow `produces`/`consumes`/`invokes`) | ❌ — `.smk`/`.nf`/`Snakefile` not even mapped to a grammar | ✅ — `.smk`/`.nf`/`Snakefile` → Python grammar + workflow resolver | `codegraph/src/extraction` has no `.smk` mapping; `src/extraction/grammars.ts:65-66,132` does |
| Confidence layering | n/a (no synthesized cross-boundary edges) | deterministic edges carry **no** provenance/confidence; heuristic edges carry both | empirical, below |
| Inline explore ceiling | ~35–38K chars on large repos (**externalizes** → agent Reads it back) | ~24K, stays under the 25K inline cap | codegraph CLAUDE.md budget table; OmniWeave `EXPLORE_INLINE_HARD_CEILING=25_000` |
| Startup-warning hygiene | prints the `node:sqlite` ExperimentalWarning every run | suppressed (this session) | `node <cg> init` output vs `omniweave index` |

## Empirical proof 1 — cross-process flow (`__tests__/fixtures/polyglot-subprocess`)

Both tools indexed the same 6-file polyglot fixture (Python/JS orchestrators that subprocess into `tool_sub.py`, `scripts/deseq.R`, `scripts/report.py`).

Edge-kind histogram of the two graphs:

```
[OmniWeave]  33 edges:  contains 21   crossLang 7   imports 5
[codegraph]  28 edges:  contains 21   imports 5     references 2
```

OmniWeave's **7 `crossLang` edges** — the boundary hops codegraph has no type for — with the live confidence layering:

```
buildReport       [build.js]    --crossLang(heuristic conf=0.85 general-crosslang)--> report.py [scripts/report.py]
buildReportSync   [build.js]    --crossLang(heuristic conf=0.85)-->                    deseq.R   [scripts/deseq.R]
dispatch_array    [dispatch.py] --crossLang(heuristic conf=0.7)-->                     tool_sub.py
dispatch_string   [dispatch.py] --crossLang(heuristic conf=0.7)-->                     tool_sub.py
run_analysis      [pipeline.py] --crossLang(heuristic conf=0.85)-->                    deseq.R
run_via_check_call[pipeline.py] --crossLang(heuristic conf=0.85)-->                    report.py
make_report       [pipeline.py] --crossLang(heuristic conf=0.8)-->                     report.py
```

Array/shell-literal targets score 0.85, a fixed interpolation 0.8, runtime-interpolated paths 0.7 — exactly the "the猜的才标 confidence" trust model. **codegraph: 0 such edges.** An agent asking "what does `pipeline.py` actually run, and where is that code?" gets the answer in one OmniWeave call and cannot get it structurally from codegraph.

## Empirical proof 2 — S4 dispatch graph (DESeq2 idiom)

Same one-file R fixture (2 `setClass`, 2 `setGeneric`, 3 `setMethod`) indexed by both:

```
OmniWeave:  8 nodes, 13 edges        codegraph:  8 nodes, 7 edges
```

Nodes + dispatch edges:

```
===== OmniWeave =====
NODES:   class DESeqDataSet · class DESeqResults
         function counts · function results                      (the generics)
         method counts    qn=DESeqDataSet::counts
         method results   qn=DESeqDataSet::results
         method results   qn=DESeqResults::results
EDGES:   contains 10   overrides 3
OVERRIDES (deterministic, prov=NONE):
   DESeqDataSet::results --overrides--> results
   DESeqDataSet::counts  --overrides--> counts
   DESeqResults::results --overrides--> results

===== codegraph =====
NODES:   class DESeqDataSet · class DESeqResults
         function counts · function counts                        (the 3 setMethod calls
         function results · function results · function results    collapse to 5 bare,
                                                                   duplicate function nodes)
EDGES:   contains 7
OVERRIDES: none
```

Real `query results` output, side by side:

```
OmniWeave                                  codegraph
---------                                  ---------
function results  DESeqClasses.R:5         function results  DESeqClasses.R:5
  cmd: omniweave node "results" ...        function results  DESeqClasses.R:8
method   results  DESeqClasses.R:8         function results  DESeqClasses.R:16
  cmd: omniweave node "results" ...
method   results  DESeqClasses.R:16        (3 indistinguishable `function results`,
  cmd: omniweave node "results" ...         no class, no override, no follow-up key)
```

OmniWeave separates the **generic** (`function`) from the two **class-dispatched implementations** (`method`, with `Class::generic` qualified names and `overrides` edges) and prints a follow-up key per result. codegraph sees three identical `function results` and cannot answer "which class overrides the generic, and where". The `overrides` edges are **deterministic** (`prov=NONE`) — contrast with the heuristic, confidence-tagged `crossLang` edges above: the two halves of the trust model, shown live.

## Reproduce

```bash
# build the competitor once
cd research/2026-06-23-codegraph-ecosystem/repos/codegraph && npm install && npm run build && cd -

# cross-process
node research/.../codegraph/dist/bin/codegraph.js init __tests__/fixtures/polyglot-subprocess
# then diff edge kinds in .omniweave/omniweave.db vs .codegraph/codegraph.db (kind histogram)

# S4: write the 3-setMethod DESeqClasses.R fixture, init with both, compare nodes/overrides
```

## Conclusion (honest)

vs its own fork base, OmniWeave's measurable, reproducible advantage is **traversable cross-boundary structure codegraph's graph cannot hold**: 7 cross-process edges vs 0, an S4 dispatch graph (3 `overrides` + `Class::generic` method nodes) vs 5 indistinguishable function nodes, plus workflow-DAG/`invokes` kinds codegraph has no type for. It is **not** more correct on the code both parse (R, TS, Python parity), and that parity now includes R — the old "codegraph has no R" note is retired. Secondary, real differences: a tighter inline explore ceiling (codegraph externalizes 35–38K explores) and cleaner startup output. The next step is a real-LLM agent A/B with each tool's MCP attached, on a cross-process / S4 question, to convert this structural reachability into a tool-call/turn delta.
