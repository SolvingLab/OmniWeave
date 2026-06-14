#!/usr/bin/env bash
# 第三轮证值 —— 大仓反向/多跳 + 形态税量化。复现命令（顺序记录，非一键跑）。
# 铁律：继承 harness 认证代理，绝不清 HTTP_PROXY（401 空跑陷阱）。版本必须 local dev build。
# model=sonnet effort=high（standing policy）。大仓后台跑、串行、每仓独立 AGENT_EVAL_OUT。
set -uo pipefail
ROOT=/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave
CORPUS=/tmp/omniweave-corpus
export MODEL=sonnet EFFORT=high

# ---- 0. corpus（depth-1 clone）+ index（local dev build；guava 实测后弃用，见 RESULTS）----
# git clone --depth 1 https://github.com/django/django.git      $CORPUS/django    # 2,922 .py
# git clone --depth 1 https://github.com/microsoft/vscode.git    $CORPUS/vscode    # 10,854 .ts
# ( cd $CORPUS/django && omniweave init -i )   # 3,005 files / 61,748 nodes / 196,028 edges
# ( cd $CORPUS/vscode && omniweave init -i )   # 11,538 files / 333,804 nodes / 1,527,558 edges (~4m38s)

# ---- 阶段 A：大仓反向全集 + impact ----
DJANGO_Q='In django, the function iri_to_uri() is defined in django/utils/encoding.py. I am about to change its signature and need the complete blast radius. List EVERY function or method that actually calls iri_to_uri() across the entire codebase — production code AND tests alike. For each, give the file path and the calling function name. Be careful to EXCLUDE mere textual references (docstrings, comments, imports, re-exports) that are not real calls. Finish with the total count of distinct calling functions.'
VSCODE_Q='In vscode, callers invoke getDecorationRange() on a text model; the concrete implementation is TextModel.getDecorationRange in src/vs/editor/common/model/textModel.ts. I am about to change its signature and need the complete blast radius. List EVERY function/method that actually calls getDecorationRange() across the codebase (production and tests), giving the file path and the calling function name for each. Exclude the interface declarations and mere type references. Then give the total count of distinct calling functions and name which editor subsystems (find, snippet, codelens, suggest, view model, etc.) depend on it.'

AGENT_EVAL_OUT=/tmp/agent-eval-r3/django MODEL=sonnet EFFORT=high \
  bash $ROOT/scripts/agent-eval/run-all.sh $CORPUS/django "$DJANGO_Q" headless
AGENT_EVAL_OUT=/tmp/agent-eval-r3/vscode MODEL=sonnet EFFORT=high \
  bash $ROOT/scripts/agent-eval/run-all.sh $CORPUS/vscode "$VSCODE_Q" headless

# ---- 阶段 B：形态税量化 + qualified_name 优化 ----
PHASEB_Q='In django, the function iri_to_uri() is defined in django/utils/encoding.py. List every function or method that actually calls iri_to_uri() across the codebase (production and tests). Give the file path and calling function for each, and the total count.'
# B-1 ToolSearch 税：with-arm deferral on vs off
bash $ROOT/eval-results/agent-ab-2026-06-13/round3/phaseB-toolsearch-tax.sh  $CORPUS/django "$PHASEB_Q" /tmp/agent-eval-r3/phaseB-django
bash $ROOT/eval-results/agent-ab-2026-06-13/round3/phaseB-tax-denominator.sh $CORPUS/django "$PHASEB_Q" /tmp/agent-eval-r3/phaseB-django2
# B-2 qualified_name 修复（src/mcp/tools.ts: callerDisplayName + formatNodeList + 2 multi-def loops）→ npm run build
# 修复后 with-arm 复跑（验证类归属 9/12→12/12）：
AGENT_EVAL_OUT=/tmp/agent-eval-r3/django-after MODEL=sonnet EFFORT=high \
  bash $ROOT/scripts/agent-eval/run-agent.sh $CORPUS/django "with-after-qnfix" "$DJANGO_Q (with its class)"
# 回归：npx vitest run（1490）+ EVAL_CORPUS={capstone,polyglot-subprocess,deseq2} npm run eval <fixture>
echo "round3 复现命令记录完毕（实际为分步后台执行，详见 RESULTS-round3.md）"
