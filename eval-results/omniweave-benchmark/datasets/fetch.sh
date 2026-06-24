#!/usr/bin/env bash
# Re-fetch every real repository used in the OmniWeave benchmark, pinned to the
# exact commit it was indexed at. Usage: bash fetch.sh <dest-dir>
# Datasets are NOT committed (too large); this script reconstructs them.
set -euo pipefail
DEST="${1:?usage: fetch.sh <dest-dir>}"
mkdir -p "$DEST"
clone() { # name url commit
  local dir="$DEST/$1"
  [ -d "$dir/.git" ] && { echo "skip $1 (exists)"; return; }
  git clone --filter=blob:none "$2" "$dir"
  git -C "$dir" checkout -q "$3"
  echo "ok $1 @ $3"
}

# --- differentiation datasets (bridge edges: S4 / crossLang / workflow / invokes) ---
clone DESeq2              https://github.com/thelovelab/DESeq2                          15f2ec9
clone SummarizedExperiment https://github.com/Bioconductor/SummarizedExperiment        ffe9db3
clone GenomicRanges       https://github.com/Bioconductor/GenomicRanges                14e5550
clone S4Vectors           https://github.com/Bioconductor/S4Vectors                    7f31eca
clone MAESTRO             https://github.com/liulab-dfci/MAESTRO                        74f10ba
clone rna-seq-star-deseq2 https://github.com/snakemake-workflows/rna-seq-star-deseq2    aa6b17e
clone chipseq-snakemake   https://github.com/snakemake-workflows/chipseq               1345df8
clone snakemake-varcall   https://github.com/snakemake-workflows/dna-seq-gatk-variant-calling cffa77a
clone nfcore-rnaseq       https://github.com/nf-core/rnaseq                             e7ca462
clone nfcore-sarek        https://github.com/nf-core/sarek                              4bd2948

# --- parity datasets (14 single-language repos) ---
clone lang-ts     https://github.com/colinhacks/zod          912f0f5
clone lang-js     https://github.com/expressjs/express       18e5985
clone lang-python https://github.com/psf/requests            d64b9ad
clone lang-go     https://github.com/spf13/cobra             ad460ea
clone lang-rust   https://github.com/BurntSushi/ripgrep      dfe4a81
clone lang-java   https://github.com/google/gson             e4f54f7
clone lang-cpp    https://github.com/fmtlib/fmt              588b3a0
clone lang-c      https://github.com/antirez/sds             5347739
clone lang-ruby   https://github.com/sinatra/sinatra         5236d34
clone lang-csharp https://github.com/dotnet/csharplang       37400ca
clone lang-php    https://github.com/nikic/FastRoute         1c96139
clone lang-swift  https://github.com/Alamofire/Alamofire     903c53c
clone lang-kotlin https://github.com/InsertKoinIO/koin       dc86ef8
clone lang-lua    https://github.com/nvim-lua/plenary.nvim   74b06c6
echo "All datasets fetched into $DEST"
