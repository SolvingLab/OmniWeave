#!/usr/bin/env bash
# 第二轮证值——专测 OmniWeave 该独赢的题型：反向 callers / 多跳组合 / S4 动态分派。
# 复用首轮已索引的仓；不清代理（继承 harness 55779 认证代理）。
set -uo pipefail
ROOT=/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave
BASE=/tmp/agent-eval-r2
CORPUS=/tmp/omniweave-corpus
export MODEL=sonnet EFFORT=high          # standing A/B policy

NAMES=(DESeq2 quarTeT ky dplyr)
QS=(
  "In DESeq2, list every function that calls the dispersions() generic (a bare S4 dispatch). Because dispersions(dds) does not name a method at the call site, also state which concrete S4 method this dispatches to for a DESeqDataSet object. How many call sites are there in total?"
  "Map quarTeT's complete subprocess dispatch tree: list every sibling .py script that quartet.py launches via subprocess, and for the AssemblyMapper path trace into the script to name the external alignment tool(s) it can invoke. Give command -> script -> external tool."
  "In ky, list every call site of the internal timeout() function defined in source/utils/timeout.ts (the helper function, NOT the timeout option). If I change its signature, exactly which functions would break? Give the complete caller list."
  "In dplyr, which user-facing exported verbs ultimately funnel through the internal mutate_cols() helper? Trace the reverse call chain from mutate_cols up to the exported functions a user would actually call. List every such verb."
)

echo "######## ROUND-2 START $(date +%H:%M:%S) ########"
for i in 0 1 2 3; do
  name="${NAMES[$i]}"; q="${QS[$i]}"; repo="$CORPUS/$name"; out="$BASE/$name"
  mkdir -p "$out"
  if [ ! -d "$repo/.git" ]; then echo "!! $name 未 clone，跳过"; continue; fi
  [ -d "$repo/.omniweave" ] || ( cd "$repo" && omniweave init -i >/dev/null 2>&1 )
  echo
  echo "================= $name $(date +%H:%M:%S) ================="
  AGENT_EVAL_OUT="$out" bash "$ROOT/scripts/agent-eval/run-all.sh" "$repo" "$q" headless 2>&1 \
    | grep -E '^(####|exit|omniweave tools|Tool calls|  by type|Result:|  tokens:)'
done
echo
echo "######## ROUND-2 COMPLETE $(date +%H:%M:%S) ########"
