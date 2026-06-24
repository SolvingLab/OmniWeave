# OmniWeave benchmark artifact

This directory is the reproducible artifact for the 2026-06-24 OmniWeave
benchmark against upstream codegraph and grep-style baselines. It is intentionally
kept separate from transient working directories (`scripts/agent-eval/.bench-out`
and `.parity-out`) so the committed record contains the Methods and Results, not
local cache state.

## Abstract

The benchmark tests the claim that OmniWeave is most useful as a structural
control layer for coding agents, not as a generic semantic search engine. The
honest result is that correctness usually ties; the measurable moat is lower
agent effort on cross-boundary structure: S4 dispatch, subprocess `crossLang`,
workflow DAGs, `invokes`, and reverse-blast queries. Literal lookups and
runtime-interpolated paths are recorded as tie/no-help/ceiling cases.

## Contents

- `datasets/MANIFEST.md` records every real repository, pinned commit, language,
  file-count role, and benchmark purpose.
- `datasets/fetch.sh <dest-dir>` reconstructs the real-repo corpus.
- `METHODOLOGY.md` and `RESULTS.md` are written as paper-ready Methods and
  Results sections.
- `questions/benchmark-questions.json` is the executed six-question A/B set.
- `questions/benchmark-questions-v2.json` is the expanded candidate bank used to
  design the multi-domain benchmark.
- `questions/benchmark-questions-v3.json` is the next locked diverse bank with
  extra S4/workflow/invokes/reverse-blast/no-help coverage.
- `harness/` contains the runner, forced-MCP hook, parity script, and scorer.
- `results/agent-ab-raw.jsonl` is the raw run table: 66 valid runs, 0 INVALID.
- `results/agent-ab-scored.md` aggregates correctness and effort by question,
  arm, mode, and model.
- `results/parity-14langs.jsonl` records 14 single-language parity probes.
- `results/structural-capability-matrix.json` records per-dataset bridge-edge
  counts for OmniWeave vs codegraph.
- `results/explore-output-evidence.txt` keeps representative tool-output
  excerpts for output-surface claims.

## Reproduction

```bash
bash eval-results/omniweave-benchmark/datasets/fetch.sh /tmp/ow-benchmark-data
bash eval-results/omniweave-benchmark/harness/lang-parity.sh /tmp/ow-benchmark-data/lang-*
DATASETS_DIR=/tmp/ow-benchmark-data \
  bash eval-results/omniweave-benchmark/harness/ab-benchmark.sh \
  eval-results/omniweave-benchmark/questions/benchmark-questions.json
node eval-results/omniweave-benchmark/harness/score-benchmark.mjs \
  eval-results/omniweave-benchmark/results/agent-ab-raw.jsonl \
  eval-results/omniweave-benchmark/questions/benchmark-questions.json
```

The runner requires local OmniWeave and the upstream codegraph checkout described
in the project docs. Agent runs also require the configured local agent CLI used
by `scripts/agent-eval/ab-benchmark.sh`. The artifact does not contain API keys,
agent credentials, cloned corpora, or generated `.omniweave`/`.codegraph`
databases.

## Results headline

- Correctness is a tie on Q1/Q2/Q3/Q4/Q5 and mostly a tie on Q6; this benchmark
  does not claim OmniWeave is generally "more correct" than grep or codegraph.
- The strongest effort win is the `invokes` workflow question: forced codegraph
  runs spend many more turns/tool calls because the graph has no workflow/tool
  edge to traverse.
- S4 dispatch is a smaller effort win because OmniWeave gives class-qualified
  method nodes while codegraph exposes indistinguishable bare function nodes.
- Runtime path interpolation is an explicit ceiling case: OmniWeave should omit
  static `crossLang` edges when the concrete path is not statically knowable.
