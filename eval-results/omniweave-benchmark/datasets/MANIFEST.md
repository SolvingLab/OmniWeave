# Dataset manifest

Every dataset is a **real, public repository** cloned at a pinned commit. Datasets
are not committed to this repo (size); `fetch.sh <dir>` reconstructs them exactly.
Both OmniWeave and upstream codegraph `1.0.1` (`a893156`) index each one.

## Differentiation datasets (bridge edges live here)

| Dataset | Commit | Language(s) | Files | Role in benchmark |
|---|---|---|---|---|
| [thelovelab/DESeq2](https://github.com/thelovelab/DESeq2) | `15f2ec9` | R, C++ | 143 | S4 dispatch (canonical Bioconductor); reverse-blast; single-point/concept honesty |
| [Bioconductor/SummarizedExperiment](https://github.com/Bioconductor/SummarizedExperiment) | `ffe9db3` | R | 82 | S4 dispatch (multi-class `cbind`, `assays`) |
| [Bioconductor/GenomicRanges](https://github.com/Bioconductor/GenomicRanges) | `14e5550` | R | 112 | S4 dispatch (`as.data.frame`, `coverage`) |
| [Bioconductor/S4Vectors](https://github.com/Bioconductor/S4Vectors) | `7f31eca` | R | 173 | S4 dispatch at scale (500 method nodes, 195 overrides) |
| [liulab-dfci/MAESTRO](https://github.com/liulab-dfci/MAESTRO) | `74f10ba` | Python, R | 1729 | crossLang **runtime ceiling** (Rscript `%s` path); workflow DAG; large-repo scale |
| [snakemake-workflows/rna-seq-star-deseq2](https://github.com/snakemake-workflows/rna-seq-star-deseq2) | `aa6b17e` | Snakemake, R | 91 | all-in-one: workflow DAG + STAR `invokes` + Snakemake→R `crossLang` + DESeq2 S4 |
| [snakemake-workflows/chipseq](https://github.com/snakemake-workflows/chipseq) | `1345df8` | Snakemake | 150 | workflow DAG + invokes |
| [snakemake-workflows/dna-seq-gatk-variant-calling](https://github.com/snakemake-workflows/dna-seq-gatk-variant-calling) | `cffa77a` | Snakemake | 74 | workflow DAG (bwa/gatk/samtools) |
| [nf-core/rnaseq](https://github.com/nf-core/rnaseq) | `e7ca462` | Nextflow | 859 | Nextflow workflow DAG (codegraph indexes 182 vs OmniWeave 712 nodes) |
| [nf-core/sarek](https://github.com/nf-core/sarek) | `4bd2948` | Nextflow | 832 | Nextflow workflow DAG (codegraph indexes 41 vs OmniWeave 745 nodes) |
| in-repo `__tests__/fixtures/capstone` | (this repo) | Snakemake, Nextflow | — | controlled workflow/invokes fixture (eval gate) |
| in-repo `__tests__/fixtures/polyglot-subprocess` | (this repo) | Python, JS, R | — | controlled crossLang fixture (eval gate) |

## Parity datasets (14 single-language repos)

| Lang | Repo | Commit | Lang | Repo | Commit |
|---|---|---|---|---|---|
| TS | colinhacks/zod | `912f0f5` | Ruby | sinatra/sinatra | `5236d34` |
| JS | expressjs/express | `18e5985` | C# | dotnet/csharplang | `37400ca` |
| Python | psf/requests | `d64b9ad` | PHP | nikic/FastRoute | `1c96139` |
| Go | spf13/cobra | `ad460ea` | Swift | Alamofire/Alamofire | `903c53c` |
| Rust | BurntSushi/ripgrep | `dfe4a81` | Kotlin | InsertKoinIO/koin | `dc86ef8` |
| Java | google/gson | `e4f54f7` | Lua | nvim-lua/plenary.nvim | `74b06c6` |
| C++ | fmtlib/fmt | `588b3a0` | C | antirez/sds | `5347739` |
