# Ground truth

Every question's answer was locked from the **real source** before any agent run,
so scoring is objective. Each entry below gives the answer and the exact
`file:line` / `setMethod` / rule that proves it — independently verifiable in the
fetched repos (see `../datasets/MANIFEST.md`).

## Core bank (`benchmark-questions.json`) — 6 questions, fully run in the agent A/B

| ID | Type | GT | Source (verify with) |
|---|---|---|---|
| Q1-s4-dispatch | differentiation | `DESeqDataSet`, `DESeqResults` | DESeq2 `R/plots.R`: `setMethod("plotMA", signature(object="DESeqDataSet"), …)` + `setMethod("plotMA", signature(object="DESeqResults"), …)` |
| Q2-crosslang-static | differentiation | `scripts/deseq.R` | polyglot `pipeline.py` `run_analysis`: `subprocess.run(["Rscript","scripts/deseq.R",…])` |
| Q3-invokes | differentiation | `STAR` | capstone `Snakefile` rule `star_align`: `wrapper: "v7.2.0/bio/star/align"` → tool `star` |
| Q4-crosslang-runtime-ceiling | honesty-ceiling | **No** (runtime path) | MAESTRO `scRNA_QC.py`: `"Rscript %s/scRNAseq_qc_filtering.R" % RSCRIPT_PATH`, `RSCRIPT_PATH=resource_filename('MAESTRO','R')` |
| Q5-single-point-tie | honesty-tie | `R/core.R` | DESeq2 `R/core.R:1333`: `nbinomWaldTest <- function(object,` |
| Q6-concept-no-help | no-help | not localizable | DESeq2: inline `stopifnot`/`match.arg` checks scattered across `R/*.R`; no validation module |

## Diverse bank (`benchmark-questions-v3.json`) — 8 questions across more datasets

| ID | Type | GT | Source |
|---|---|---|---|
| v3-S4-se-cbind | differentiation | `Assays`, `SummarizedExperiment` | SummarizedExperiment: `setMethod("cbind","Assays",…)` + `setMethod("cbind","SummarizedExperiment",…)` |
| v3-S4-gr-asdf | differentiation | `GenomicRanges`, `GPos` | GenomicRanges: `setMethod("as.data.frame","GenomicRanges",…)` + `setMethod("as.data.frame","GPos",…)` |
| v3-CL-rnaseq-r | differentiation | `workflow/scripts/deseq2-init.R` | rna-seq-star-deseq2 `workflow/rules/diffexp.smk` rule `deseq2_init` `script: "../scripts/deseq2-init.R"` (OmniWeave crossLang conf=0.95) |
| v3-WF-rnaseq-dag | differentiation | `star_align` | rna-seq-star-deseq2 `workflow/rules/align.smk` rule `star_align` output `Aligned.sortedByCoord.out.bam` |
| v3-INV-rnaseq-star | differentiation | `STAR` | same rule `wrapper: "v7.2.0/bio/star/align"` |
| v3-RB-deseq2-callers | differentiation | `DESeq`, `refitWithoutOutliers`, `lfcShrink` | DESeq2 `omniweave callers nbinomWaldTest`: `DESeq` (R/core.R:274), `refitWithoutOutliers` (R/core.R:2504), `lfcShrink` (R/lfcShrink.R:145) |
| v3-CL-maestro-ceiling | honesty-ceiling | **No** (runtime path) | same as Q4, second dataset sample |
| v3-H-se-concept | no-help | not localizable | SummarizedExperiment: inline `validity`/`stopifnot` scattered; no validation module |

## Scoring

`../harness/score-benchmark.mjs` matches each answer (lowercased, EN + 中文) to
the GT keyword set above; a run is `CORRECT` only if the GT predicate holds.
Honesty questions (ceiling / no-help) are scored `CORRECT` when the agent gives
the *honest* answer ("not statically resolvable", "scattered / not localizable")
— fabricating a confident wrong answer is scored wrong. A tie is a tie.
