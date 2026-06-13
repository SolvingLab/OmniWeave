# OmniWeave Differentiator Query Benchmark

Commit `06e0375` · 7 queries · OmniWeave-wins 5, tied 1, grep-wins 1

Measures the bounded class of agent queries where OmniWeave answers in ONE structural
call. The win is **structure / composition / cross-boundary**, not raw character count —
grep can be terse, so `Grep lines` is the *real* `grep` output an agent consumes, a
lower-bound proxy for context tokens, NOT total file size. Tied and grep-wins rows are
included so this is a fair comparison. LSP verdicts cite the LSP 3.17 request-type gap
(no server spun up — the gap is categorical, not server-quality dependent).

| # | Query | Corpus | OW calls | OW ms | OW answer | grep calls | grep lines | grep verdict | LSP | Winner |
|---|-------|--------|---------:|------:|-----------|-----------:|-----------:|--------------|-----|--------|
| Q1 | List the S4 methods dispatching on class GeneModel | capstone | 1 | 0.18 | 2 dispatched methods (typed contains edges) | 1 | 2 | FEASIBLE-COSTLY (raw setMethod hits, agent must parse which dispatch on GeneModel; no machine-typed result) | CANNOT-STRUCTURAL (no LSP 3.17 request encodes dispatch-table membership for a class; callHierarchy/incomingCalls finds callers of a generic, not setMethod registrations) | **OMNIWEAVE** |
| Q2 | What script does Snakemake rule fit_model run? | capstone | 1 | 0.19 | crossLang → scripts/model.R (1 typed edge) | 2 | 6 | FEASIBLE (find the rule, then read its script: directive — 2 passes, unstructured) | CANNOT-STRUCTURAL (LSP is language-scoped; no request bridges .smk → the .R it invokes) | **OMNIWEAVE** |
| Q3 | From rule fit_model, reach the S4 dispatch method across the process boundary | capstone | 1 | 0.61 | connected path, 2 hops | 5 | 4 | CANNOT-PROVE-COMPOSITION (grep can spot-check each hop independently but cannot prove they share nodes — a crossLang landing in a different file than the S4 class owner would pass every per-hop grep) | CANNOT-STRUCTURAL (cross-language process boundary + S4 dispatch registry — no request covers either) | **OMNIWEAVE-STRUCTURAL** |
| Q4 | What R template does Nextflow process PREDICT run? | capstone | 1 | 0.2 | crossLang → templates/predict.R (1 typed edge) | 2 | 2 | FEASIBLE-COSTLY (find process, read its template directive, resolve templates/ convention) | CANNOT-STRUCTURAL (cross-language .nf → .R, no LSP request crosses it) | **OMNIWEAVE** |
| Q5 | What script does the Python function run_analysis shell out to? | polyglot-subprocess | 1 | 0.09 | crossLang → scripts/deseq.R (typed edge, py→R) | 1 | 11 | FEASIBLE (the call site is greppable, but the py→R link is text the agent must resolve; no edge to traverse onward) | CANNOT-STRUCTURAL (a Python LSP does not resolve a subprocess argument into the R file it names) | **OMNIWEAVE** |
| Q6 | Where is the function render defined? | polyglot-subprocess | 1 | 0.1 | scripts/report.py (1 node) | 1 | 1 | FEASIBLE (1 pass, 1 line) — TIED | CAN (textDocument/definition) | **TIED** |
| Q7 | Which files mention the string "Rscript"? | polyglot-subprocess | 1 | 0.84 | partial — symbol index is not full-text | 1 | 4 | GREP-WINS (raw text presence, zero indexing overhead — grep is the right tool) | CANNOT-STRUCTURAL (not a symbol query) | **GREP** |

## Honest reading

- **Q1–Q5 OmniWeave-wins** are all queries that cross a boundary (S4 dispatch registry,
  workflow→script, py→R subprocess) or require composition (Q3). grep is *feasible* for
  Q1/Q2/Q4/Q5 but returns unstructured text with no edge to traverse onward; for Q3 grep
  is **structurally unable** to prove the hops connect. LSP cannot answer any of them —
  not a speed gap, a categorical one (no request type maps to cross-language/dispatch).
- **Q6 is genuinely TIED** — a plain definition lookup is 1 grep line and a 1-hop LSP
  request. OmniWeave has no edge here it doesn't.
- **Q7 is GREP-WINS** — full-text presence is grep's home turf; the symbol index is the
  wrong tool. Included to keep the benchmark honest.

OmniWeave's crossLang/dispatch edges are `provenance: heuristic` with a `confidence`
score (surfaced, not hidden) — they are inferred, not compiler-verified. The claim is
narrow and defensible: *these boundary/composition query shapes collapse to one typed,
traversable call*, which is exactly the zone grep degrades in and LSP cannot enter.
