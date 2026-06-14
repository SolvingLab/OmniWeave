#!/usr/bin/env bash
# Round 6 — Track 2: weak-model (haiku) moat matrix.
# 4 archetypes × haiku × 3 with + 3 without, via run-round4.sh. Sonnet baselines
# for the SAME questions come from rounds 3-5 (reused, not re-run). Inherits the
# harness auth proxy — DO NOT clear it. Serial (one repo at a time).
#
# Usage: bash run-track2-haiku.sh   (set N via $N, default 3)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RUNNER="$HERE/../round4/run-round4.sh"
CORPUS=/tmp/omniweave-corpus
N="${N:-3}"
export ROUND4_OUT=/tmp/agent-eval-r6
export MODEL=haiku EFFORT=high

echo "########## TRACK2 HAIKU MATRIX (N=$N each arm) ##########"

# 1) 单点 (single-point, grep's home turf — narrowest moat expected)
bash "$RUNNER" "$CORPUS/DESeq2" \
  "What is the exact function signature of \`nbinomWaldTest\` and which file/line is it defined at? Give the full argument list." \
  t2-haiku-single "$N"

# 2) 反向 callers (moat opens)
bash "$RUNNER" "$CORPUS/django" \
  "List every distinct function or method that calls \`iri_to_uri\` in this codebase, with file:line for each. Give the exact total count of distinct callers." \
  t2-haiku-reverse "$N"

# 3) 大仓 blast-radius / transitive impact (widest moat at scale)
bash "$RUNNER" "$CORPUS/django" \
  "What is the full transitive blast radius of \`get_srid_info\` — every symbol that would be affected if its behavior changed (callers, callers of callers, …)? List them and give the total." \
  t2-haiku-blast "$N"

# 4) 跨进程 (cross-process, LSP-blind)
bash "$RUNNER" "$CORPUS/quarTeT" \
  "Which other scripts in this repo does \`quartet.py\` run as subprocesses (e.g. via os.system / subprocess)? List each script it shells out to." \
  t2-haiku-crossproc "$N"

echo "########## TRACK2-HAIKU-DONE ##########"
