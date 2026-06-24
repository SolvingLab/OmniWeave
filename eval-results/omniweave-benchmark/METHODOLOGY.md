# Methodology

This document is written to be used directly as the **Methods** section of a paper.

## 1. Systems under comparison

| System | Version / commit | What it is |
|---|---|---|
| **OmniWeave** | this repository (`dist/.build-id` fingerprint recorded per run) | a local-first MCP code-analysis graph; tree-sitter extraction → SQLite (`node:sqlite`, WAL) → resolution/synthesis → `explore`/`node`/`search`/`callers`/`impact` |
| **codegraph** (baseline) | `@colbymchenry/codegraph@1.0.1`, commit `a893156` | the upstream project OmniWeave is forked from; same tree-sitter/SQLite architecture, **12 standard edge kinds**, no cross-boundary edge kinds |
| **grep / read** | n/a | a coding agent with only shell + file-read tools (no structural index) |

Both graph tools are *built from source* and index every dataset into their own
on-disk store (`.omniweave/` vs `.codegraph/`), which coexist in the same repo.

## 2. Datasets

24 **real, public repositories** at pinned commits (full list + URLs + commits +
roles in `datasets/MANIFEST.md`; `datasets/fetch.sh` reconstructs them exactly):

- **4 R / Bioconductor packages** for S4 dispatch (DESeq2, SummarizedExperiment,
  GenomicRanges, S4Vectors), plus a large polyglot pipeline (MAESTRO, 1729 files).
- **5 workflow pipelines** — Snakemake (rna-seq-star-deseq2, chipseq,
  dna-seq-gatk-variant-calling) and Nextflow (nf-core/rnaseq, nf-core/sarek).
- **14 single-language repos** (TS, JS, Python, Go, Rust, Java, C++, C, Ruby, C#,
  PHP, Swift, Kotlin, Lua) for the parity matrix.
- **2 controlled in-repo fixtures** (capstone, polyglot-subprocess) as eval gates.

## 3. Three measurement parts

### Part A — cross-language parity (structural)
Each single-language repo is indexed by both tools; we diff node counts and
per-edge-kind histograms. Purpose: confirm a fork does not *regress* its base on
the 12 standard kinds, and confirm bridge edges are *absent* in single-language
code (so any differentiation is scenario-specific, not a "bigger graph"). Tooling:
`harness/lang-parity.sh` → `results/parity-14langs.jsonl`.

### Part B — bridge-edge capability (structural)
Every dataset is indexed by both tools; we count, per tool, the bridge edge kinds
(`crossLang`, `produces`, `consumes`, `invokes`), the S4 `method` nodes, and the
`overrides` dispatch edges. Purpose: quantify the structure one tool can represent
and the other cannot. Output: `results/structural-capability-matrix.json`. We also
capture real side-by-side `explore`/`query`/`callers` output
(`results/explore-output-evidence.txt`).

### Part C — agent A/B (behavioral, real LLM)
A real LLM agent answers each ground-truth-locked question with each tool
attached, and we measure correctness and effort.

- **Models**: `mimo-v2.5-pro` (primary) and `mimo-v2.5` (weaker tier), both via the
  Anthropic-protocol endpoint, driving the `claude` CLI. Keys are read from the
  environment only and never written to disk or logs.
- **Arms**: omniweave-MCP, codegraph-MCP, grep/read-only (empty MCP).
- **Modes**: **natural** (shell allowed → measures whether the agent *adopts* the
  MCP tool) and **forced** (a `PreToolUse` hook, `harness/force-mcp-hook.sh`,
  denies Bash/Grep/Glob/source-Read → measures whether the MCP, once it is the
  only option, is *sufficient* to answer). Forced mode isolates tool sufficiency
  from tool adoption — the key to seeing where a structural edge becomes a
  measurable answer/effort delta rather than a graph statistic.
- **Runs**: 3 per forced-pro cell, 2 per forced-weak and natural cell.
- **Matrix per question** (differentiation): forced × {ow, cg} × {pro, weak} +
  natural × {ow, cg, grep} × pro. Honesty questions: natural × {ow, grep} × pro.
- **Daemon pre-warm**: each arm pre-warms its MCP daemon (`serve --mcp`) and skips
  the WASM re-exec so the agent attaches before its first turn (otherwise a nested
  agent dives into shell before the MCP is up — a known attach-latency confound).
- **Integrity (fail-closed)**: any `claude` non-zero exit, empty transcript, or
  missing `result` event marks the run `INVALID`; INVALID runs are recorded with
  `valid:false` and **never** scored as wins. Tooling: `harness/ab-benchmark.sh`.

## 4. Ground truth & scoring

Each question's answer is locked from real source **before** any run
(`questions/GROUND-TRUTH.md`, every answer cites a `file:line` / `setMethod` /
rule). `harness/score-benchmark.mjs` matches each answer (lowercased, English +
中文) against the GT predicate; correctness is binary. Effort = mean tool-calls,
reads, and assistant turns per cell. **Honesty discipline**: ties and ceilings are
reported as such; we never claim "more correct". The benchmark deliberately
includes tie / no-help / runtime-ceiling questions so a win cannot be cherry-picked.

## 5. Reproduce

```bash
bash datasets/fetch.sh /tmp/ow-datasets                       # real repos at pinned commits
bash harness/lang-parity.sh /tmp/ow-datasets/lang-*           # Part A
DATASETS_DIR=/tmp/ow-datasets bash harness/ab-benchmark.sh \
  questions/benchmark-questions.json                           # Part C (export ANTHROPIC_* first)
node harness/score-benchmark.mjs <results.jsonl> <questions.json>
```
