# Agent A/B benchmark — scored


## Q1-s4-dispatch  (differentiation)  — GT: DESeqDataSet, DESeqResults
arm/mode/model                           correct mcp read grep bash turns
codegraph/forced/mimo-v2.5               2/2     1.0  0.0  1.0  2.5  15.0
codegraph/forced/mimo-v2.5-pro           3/3     1.0  0.7  0.3  1.7  15.3
codegraph/natural/mimo-v2.5-pro          2/2     0.0  0.0  0.0  1.5   6.0
grep/natural/mimo-v2.5-pro               2/2     0.0  0.0  0.0  1.5   5.0
omniweave/forced/mimo-v2.5               2/2     2.0  0.0  1.0  1.0  15.0
omniweave/forced/mimo-v2.5-pro           3/3     1.0  0.0  0.0  1.3   9.3
omniweave/natural/mimo-v2.5-pro          2/2     0.0  0.0  1.0  1.0   8.0

## Q2-crosslang-static  (differentiation)  — GT: scripts/deseq.R
arm/mode/model                           correct mcp read grep bash turns
codegraph/forced/mimo-v2.5               2/2     1.0  1.0  1.5  8.0  39.0
codegraph/forced/mimo-v2.5-pro           3/3     1.0  0.7  0.3  1.3  14.7
codegraph/natural/mimo-v2.5-pro          2/2     0.0  0.5  0.0  1.5   7.0
grep/natural/mimo-v2.5-pro               2/2     0.0  0.5  0.0  1.5   7.0
omniweave/forced/mimo-v2.5               2/2     2.0  1.0  0.5  1.5  18.0
omniweave/forced/mimo-v2.5-pro           3/3     1.0  1.3  0.0  2.0  17.7
omniweave/natural/mimo-v2.5-pro          2/2     0.0  1.0  0.5  1.0   7.0

## Q3-invokes  (differentiation)  — GT: STAR
arm/mode/model                           correct mcp read grep bash turns
codegraph/forced/mimo-v2.5               2/2     9.0  3.0  0.5  4.0  45.5
codegraph/forced/mimo-v2.5-pro           3/3     4.7  3.7  0.3  2.7  36.0
codegraph/natural/mimo-v2.5-pro          2/2     0.0  0.0  0.5  2.5   7.5
grep/natural/mimo-v2.5-pro               2/2     0.0  0.0  0.0  2.5   7.0
omniweave/forced/mimo-v2.5               2/2     0.5  1.0  0.5  1.0  12.0
omniweave/forced/mimo-v2.5-pro           3/3     0.7  1.7  0.0  2.7  16.0
omniweave/natural/mimo-v2.5-pro          2/2     0.0  0.0  0.0  3.0   9.0

## Q4-crosslang-runtime-ceiling  (honesty-ceiling)  — GT: No — the path is runtime-interpolated (RSCRIPT_PATH = an install-dir resolved at
arm/mode/model                           correct mcp read grep bash turns
grep/natural/mimo-v2.5-pro               3/3     0.0  0.0  0.3  5.3  13.0
omniweave/natural/mimo-v2.5-pro          3/3     0.0  0.7  0.7  3.0  10.3

## Q5-single-point-tie  (honesty-tie)  — GT: R/core.R
arm/mode/model                           correct mcp read grep bash turns
grep/natural/mimo-v2.5-pro               3/3     0.0  0.0  0.0  2.3   8.7
omniweave/natural/mimo-v2.5-pro          3/3     0.0  0.0  0.0  2.7   7.7

## Q6-concept-no-help  (no-help)  — GT: Not localizable to a single structural symbol — argument checks are scattered in
arm/mode/model                           correct mcp read grep bash turns
grep/natural/mimo-v2.5-pro               2/3     0.0  0.3  0.0  4.7  12.0
omniweave/natural/mimo-v2.5-pro          3/3     0.0  0.0  0.0  4.0   9.0


# Honest verdict per question

- **Q1-s4-dispatch** (differentiation): omniweave 7/7  codegraph 7/7  grep 2/2
- **Q2-crosslang-static** (differentiation): omniweave 7/7  codegraph 7/7  grep 2/2
- **Q3-invokes** (differentiation): omniweave 7/7  codegraph 7/7  grep 2/2
- **Q4-crosslang-runtime-ceiling** (honesty-ceiling): omniweave 3/3  grep 3/3
- **Q5-single-point-tie** (honesty-tie): omniweave 3/3  grep 3/3
- **Q6-concept-no-help** (no-help): omniweave 3/3  grep 2/3
