#!/usr/bin/env bash
# OmniWeave 证值矩阵 runner —— 串行跑 4 仓 with/without A/B（headless）。
# 结果按仓隔离到 /tmp/agent-eval/<name>/，第一仓 fail-fast。
set -uo pipefail

ROOT=/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave
AUDIT="$ROOT/scripts/agent-eval/audit.sh"
BASE=/tmp/agent-eval
mkdir -p "$BASE"

# 走 TUN：清掉 HTTP 代理 env（audit.sh 调的是 claude binary，不走 zsh function）
export ALL_PROXY="" HTTP_PROXY="" HTTPS_PROXY="" http_proxy="" https_proxy="" NO_PROXY="*"
# standing A/B policy（CLAUDE.md）：model=sonnet effort=high，别提高
export MODEL=sonnet EFFORT=high CORPUS=/tmp/omniweave-corpus

NAMES=(DESeq2 quarTeT ky dplyr)
URLS=(
  "https://github.com/thelovelab/DESeq2"
  "https://github.com/aaranyue/quarTeT"
  "https://github.com/sindresorhus/ky"
  "https://github.com/tidyverse/dplyr"
)
QS=(
  "In DESeq2, when estimateDispersions() is called on a DESeqDataSet object, which S4 method implementation runs (the setMethod for that signature), and what does that method call or dispatch to next? Name the generic, the DESeqDataSet method, and the next call in order."
  "In quarTeT, the command-line entry dispatches subcommands that run other Python scripts as subprocesses. For the AssemblyMapper subcommand, which sibling .py script does it ultimately invoke, and from which function/file? Name the orchestrating file/function and the target script."
  "How does ky implement request retries and timeouts?"
  "When mutate() is called on a grouped data frame in dplyr, which functions handle the grouping and expression evaluation, in order, from mutate() down? Name the key functions on the path."
)

echo "######## MATRIX START $(date +%H:%M:%S) ########"
for i in 0 1 2 3; do
  name="${NAMES[$i]}"; url="${URLS[$i]}"; q="${QS[$i]}"
  out="$BASE/$name"; mkdir -p "$out"
  echo
  echo "================= [$((i+1))/4] $name START $(date +%H:%M:%S) ================="
  AGENT_EVAL_OUT="$out" bash "$AUDIT" local "$name" "$url" "$q" headless > "$out/audit.log" 2>&1
  rc=$?
  withf="$out/run-headless-with.jsonl"; wof="$out/run-headless-without.jsonl"
  wl=$( [ -f "$withf" ] && wc -l < "$withf" | tr -d ' ' || echo 0 )
  ol=$( [ -f "$wof" ]  && wc -l < "$wof"  | tr -d ' ' || echo 0 )
  echo "================= [$((i+1))/4] $name DONE rc=$rc  with=${wl}ln without=${ol}ln $(date +%H:%M:%S) ================="
  if [ "$i" -eq 0 ] && { [ "$rc" -ne 0 ] || [ "$wl" -lt 2 ]; }; then
    echo "!!!! FATAL: 第一仓 DESeq2 with-arm 异常（rc=$rc with=${wl}ln）—— 中止矩阵，先修 harness。tail audit.log:"
    tail -25 "$out/audit.log"
    exit 1
  fi
done
echo
echo "######## MATRIX COMPLETE $(date +%H:%M:%S) ########"
