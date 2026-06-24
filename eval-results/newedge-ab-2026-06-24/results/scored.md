# Agent A/B benchmark — scored


## NE-rtk-hook  (differentiation)  — GT: /api
arm/mode/model                           correct mcp read grep bash turns
codegraph/forced/mimo-v2.5               2/2     1.0  1.5  0.5  2.5  21.0
codegraph/forced/mimo-v2.5-pro           3/3     1.0  0.0  0.0  1.0   9.3
codegraph/natural/mimo-v2.5-pro          2/2     0.0  0.5  0.0  1.5   6.0
grep/natural/mimo-v2.5-pro               2/2     0.0  0.5  0.0  2.0   8.5
omniweave/forced/mimo-v2.5               2/2     3.5  0.5  0.5  1.5  18.5
omniweave/forced/mimo-v2.5-pro           3/3     1.0  1.3  0.3  2.0  18.7
omniweave/natural/mimo-v2.5-pro          2/2     0.0  1.0  0.0  1.5   7.5

## NE-pinia-login  (differentiation)  — GT: src/store/auth.js
arm/mode/model                           correct mcp read grep bash turns
codegraph/forced/mimo-v2.5               2/2     1.0  1.0  1.0  2.0  13.0
codegraph/forced/mimo-v2.5-pro           3/3     1.0  0.7  0.3  1.7  12.3
codegraph/natural/mimo-v2.5-pro          2/2     0.0  1.0  0.0  0.0   4.0
grep/natural/mimo-v2.5-pro               1/2     0.0  1.0  0.0  0.0   5.0
omniweave/forced/mimo-v2.5               2/2     1.0  2.0  1.0  4.5  25.5
omniweave/forced/mimo-v2.5-pro           3/3     1.0  1.3  0.3  1.0  12.0
omniweave/natural/mimo-v2.5-pro          2/2     0.0  0.0  1.0  4.0  10.5

## NE-sidekiq-worker  (differentiation)  — GT: DestroyUserWorker
arm/mode/model                           correct mcp read grep bash turns
codegraph/forced/mimo-v2.5               1/2     0.5  0.0  0.0  1.5   8.5
codegraph/forced/mimo-v2.5-pro           3/3     1.0  1.7  0.3  3.3  30.3
codegraph/natural/mimo-v2.5-pro          2/2     0.0  1.5  0.0  2.0   7.5
grep/natural/mimo-v2.5-pro               2/2     0.0  1.5  0.5  1.5   7.5
omniweave/forced/mimo-v2.5               2/2     3.5  0.0  0.5  2.5  16.5
omniweave/forced/mimo-v2.5-pro           3/3     1.0  0.0  0.0  1.7   9.3
omniweave/natural/mimo-v2.5-pro          2/2     0.0  1.5  0.0  2.0   7.5

## NE-celery-task  (differentiation)  — GT: send_welcome_email
arm/mode/model                           correct mcp read grep bash turns
codegraph/forced/mimo-v2.5               2/2     1.0  0.0  0.5  1.5  14.0
codegraph/forced/mimo-v2.5-pro           3/3     1.0  1.0  0.0  2.3  17.3
codegraph/natural/mimo-v2.5-pro          2/2     0.0  1.0  0.5  2.0   7.5
grep/natural/mimo-v2.5-pro               2/2     0.0  1.0  0.0  1.5   8.5
omniweave/forced/mimo-v2.5               2/2     2.5  1.0  0.5  2.0  18.5
omniweave/forced/mimo-v2.5-pro           3/3     1.7  1.3  0.0  2.0  17.3
omniweave/natural/mimo-v2.5-pro          2/2     0.0  1.0  0.0  1.5   8.5

## NE-modvar-impact  (honesty-tie)  — GT: check_compatibility
arm/mode/model                           correct mcp read grep bash turns
grep/natural/mimo-v2.5-pro               3/3     0.0  1.0  0.0  0.0   4.0
omniweave/natural/mimo-v2.5-pro          3/3     0.0  1.0  0.3  0.3   5.3

## NE-singlepoint-tie  (honesty-tie)  — GT: src/requests/__init__.py
arm/mode/model                           correct mcp read grep bash turns
grep/natural/mimo-v2.5-pro               3/3     0.0  0.0  0.0  1.0   4.7
omniweave/natural/mimo-v2.5-pro          3/3     0.0  0.0  0.0  1.7   6.3

## NE-nohelp  (no-help)  — GT: No — requests is an HTTP client library with no built-in metrics dashboard/UI.
arm/mode/model                           correct mcp read grep bash turns
grep/natural/mimo-v2.5-pro               3/3     0.0  0.0  0.0  1.0   4.0
omniweave/natural/mimo-v2.5-pro          3/3     0.0  0.0  0.0  0.0   2.0


# Honest verdict per question

- **NE-rtk-hook** (differentiation): omniweave 7/7  codegraph 7/7  grep 2/2
- **NE-pinia-login** (differentiation): omniweave 7/7  codegraph 7/7  grep 1/2
- **NE-sidekiq-worker** (differentiation): omniweave 7/7  codegraph 6/7  grep 2/2
- **NE-celery-task** (differentiation): omniweave 7/7  codegraph 7/7  grep 2/2
- **NE-modvar-impact** (honesty-tie): omniweave 3/3  grep 3/3
- **NE-singlepoint-tie** (honesty-tie): omniweave 3/3  grep 3/3
- **NE-nohelp** (no-help): omniweave 3/3  grep 3/3
