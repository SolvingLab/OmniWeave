#!/usr/bin/env bash
# 修复版重跑(不清代理，继承 harness 55779 认证代理)——quarTeT/ky/dplyr。
# index 已由首轮 audit 建好；缺失则就地 reindex。global omniweave = dev build。
set -uo pipefail
ROOT=/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave
BASE=/tmp/agent-eval
CORPUS=/tmp/omniweave-corpus
export MODEL=sonnet EFFORT=high          # standing A/B policy
# 关键：不导出任何 proxy 变量

NAMES=(quarTeT ky dplyr)
QS=(
  "In quarTeT, the command-line entry dispatches subcommands that run other Python scripts as subprocesses. For the AssemblyMapper subcommand, which sibling .py script does it ultimately invoke, and from which function/file? Name the orchestrating file/function and the target script."
  "How does ky implement request retries and timeouts?"
  "When mutate() is called on a grouped data frame in dplyr, which functions handle the grouping and expression evaluation, in order, from mutate() down? Name the key functions on the path."
)

echo "######## RERUN START $(date +%H:%M:%S) ########"
for i in 0 1 2; do
  name="${NAMES[$i]}"; q="${QS[$i]}"; repo="$CORPUS/$name"; out="$BASE/$name"
  mkdir -p "$out"
  if [ ! -d "$repo/.git" ]; then echo "!! $name 未 clone，跳过"; continue; fi
  if [ ! -d "$repo/.omniweave" ]; then
    echo "→ reindex $name"; ( cd "$repo" && omniweave init -i >/dev/null 2>&1 )
  fi
  echo
  echo "================= $name $(date +%H:%M:%S) ================="
  AGENT_EVAL_OUT="$out" bash "$ROOT/scripts/agent-eval/run-all.sh" "$repo" "$q" headless 2>&1 \
    | grep -E '^(####|exit|omniweave tools|Tool calls|  by type|Result:|  tokens:)'
done
echo
echo "######## RERUN COMPLETE $(date +%H:%M:%S) ########"
