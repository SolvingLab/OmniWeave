# New-edge A/B Run Manifest

Generated: 2026-06-24T12:28:12Z

## Run Identity

| item | value |
|---|---|
| Matrix | 82 runs, 0 harness-invalid |
| Driver | `claude -p --output-format stream-json --verbose --permission-mode bypassPermissions --max-budget-usd 3` |
| Models | `mimo-v2.5-pro`; `mimo-v2.5` on forced headline cells |
| Timeout | 240 s per cell |
| Runner worktree | `/Users/liuzaoqu/ow-ab-wt` |
| Runner git commit | `2a24004ffb0374a38ca8a8e20e686cbcacacd0af` |
| Runner worktree state | detached HEAD; local benchmark question/scorer files present; `node_modules` untracked |
| Artifact parent commit | `d81282efdcd22776534e319adf8588ef8386ad0d` |
| OmniWeave runtime build fingerprint | `1.0.0+ca1c74402401` |
| Upstream codegraph commit | `a89315645dd4919f1e7c251b562c6c377e7f03ad` |
| Upstream codegraph path | `research/2026-06-23-codegraph-ecosystem/repos/codegraph/dist/bin/codegraph.js` |
| Dataset stage | `/Users/liuzaoqu/ow-newedge-targets` |

## Inputs

| artifact | sha256 |
|---|---|
| `questions/benchmark-questions-newedge.json` | `79f1389b2a7ab3a457f763689235c4f85717a84519144821ed8b1b834a7595f0` |
| `scripts/agent-eval/score-benchmark.mjs` | `c07acdd9938a92b7b011c9a929f4a3ec259ec678ab646402c55a2e0b879bee88` |
| `scripts/agent-eval/parse-benchmark-runs.mjs` | `acd6018ee2b40e84136357c78116fa0b486ee82d30d83921bc670577288fcac2` |
| `harness/setup-newedge-targets.sh` | `31e06017e8426339aafb8c78e01a0b79e1fa563a1a8571ac56bffd8dde59771a` |
| `datasets/MANIFEST.md` | `20d0dd0f75d9c36f37f1386238371521c5790cafebac9360a81560542a6b16ce` |

## Outputs

| artifact | count/hash |
|---|---|
| `results/raw/transcripts/*.jsonl` | 82 stream-json transcripts |
| `results/raw/stderr/*.err` | 82 stderr files |
| `results/raw/summary-results.jsonl` | 82 rows; `ceb38e90726ff13511c7ef4394b1578397926402b01179658ddf989bbfc13d2a` |
| `results/runs.jsonl` | 82 rows; `2b91e38308d5a13303aed250b1ad39a88e1d7e521d5fc79c1624703d8521004f` |
| `results/scored.jsonl` | 82 rows; `17b1374f2b9ce1ed1cffb133344252405de07680a94983722a0224692c605159` |
| `results/scored.md` | strict scorer stdout from `--require-complete` |
| `results/raw/driver.log` | full cell log + final `DONE: 82 runs, 0 invalid` |

## Target Provenance

| target | source | commit / status |
|---|---|---|
| `rtk` | `eval-results/framework-parity-2026-06-24/dispatch-fixtures/rtk` | controlled fixture in OmniWeave checkout |
| `celery` | `eval-results/framework-parity-2026-06-24/dispatch-fixtures/celery` | controlled fixture in OmniWeave checkout |
| `sidekiq` | `eval-results/framework-parity-2026-06-24/dispatch-fixtures/sidekiq` | controlled fixture in OmniWeave checkout |
| `vue-realworld` | `https://github.com/gothinkster/vue-realworld-example-app` via `/tmp/ow-vue-realworld` | `f7e48c8`; local `.omniweave/` untracked |
| `requests` | `https://github.com/psf/requests` via `/Users/liuzaoqu/ow-bench-datasets/lang-python` | `d64b9ad4`; local `.omniweave/` untracked |

## Reproduction Commands

```bash
bash eval-results/newedge-ab-2026-06-24/harness/setup-newedge-targets.sh
DATASETS_DIR="$HOME/ow-newedge-targets" \
OUT="$PWD/scripts/agent-eval/.bench-out-newedge" \
bash scripts/agent-eval/ab-benchmark.sh scripts/agent-eval/benchmark-questions-newedge.json

node scripts/agent-eval/parse-benchmark-runs.mjs \
  scripts/agent-eval/.bench-out-newedge \
  scripts/agent-eval/.bench-out-newedge/results.jsonl \
  > eval-results/newedge-ab-2026-06-24/results/runs.jsonl

node scripts/agent-eval/score-benchmark.mjs \
  --require-complete \
  --scored-jsonl eval-results/newedge-ab-2026-06-24/results/scored.jsonl \
  eval-results/newedge-ab-2026-06-24/results/runs.jsonl \
  eval-results/newedge-ab-2026-06-24/questions/benchmark-questions-newedge.json \
  > eval-results/newedge-ab-2026-06-24/results/scored.md
```

## Notes

The benchmark was already running when scorer hardening landed in this checkout. For
that reason, `results/raw/summary-results.jsonl` is treated as an untrusted parsed run
summary from the live harness. The committed `runs.jsonl` and `scored.jsonl` are the
derived artifacts used for conclusions: they rebuild full final answers from raw
stream transcripts, then apply the stricter scorer with `--require-complete`.
