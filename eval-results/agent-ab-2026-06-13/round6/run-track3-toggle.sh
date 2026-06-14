#!/usr/bin/env bash
# Round 6 — Track 3: isolate the ToolSearch GATING cost (candidate ②).
# BOTH arms mount the SAME omniweave MCP config; the ONLY variable is whether
# Claude Code DEFERS the tools (ToolSearch gating). Default = gated (agent must
# call ToolSearch before any omniweave tool, +1 round-trip). ENABLE_TOOL_SEARCH=
# auto:100 = eager-load (no deferral for small tool counts), so the agent calls
# omniweave tools directly. Measures the steady-state turn/token cost of gating.
# Inherits the harness auth proxy — DO NOT clear it.
#
# Usage: bash run-track3-toggle.sh   (N via $N, default 3)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HARNESS="$HERE/../../../scripts/agent-eval"
CG_BIN="$(command -v omniweave)"
REPO=/tmp/omniweave-corpus/DESeq2          # single-point題: gating round-trip = pure overhead
N="${N:-3}"
MODEL="${MODEL:-sonnet}" EFFORT="${EFFORT:-high}"
OUT=/tmp/agent-eval-r6/t3-toggle
mkdir -p "$OUT"
Q='What is the exact function signature of `nbinomWaldTest` (its full argument list) and which file and line is it defined at?'

cat > "$OUT/mcp-omniweave.json" <<JSON
{"mcpServers":{"omniweave":{"command":"$CG_BIN","args":["serve","--mcp","--path","$REPO"]}}}
JSON

echo "########## TRACK3 TOOLSEARCH-GATING TOGGLE (N=$N, $MODEL/$EFFORT) ##########"
echo "repo=$REPO  omniweave=$CG_BIN ($($CG_BIN --version))"

one() {  # arm  extra-env-assignment  run-id
  local arm="$1" envset="$2" rid="$3"
  local out="$OUT/$arm-r$rid.jsonl" err="$OUT/$arm-r$rid.err"
  ( cd "$REPO" && env $envset claude -p "$Q" \
      --output-format stream-json --verbose \
      --permission-mode bypassPermissions \
      --model "$MODEL" --effort "$EFFORT" \
      --max-budget-usd 3 \
      --strict-mcp-config --mcp-config "$OUT/mcp-omniweave.json" \
      > "$out" 2>"$err" )
  echo "[$arm r$rid] exit $? -> $out ($(wc -l < "$out" | tr -d ' ') lines)"
  node "$HARNESS/parse-run.mjs" "$out" 2>&1 | sed 's/^/    /' || true
}

for i in $(seq 1 "$N"); do
  echo "==================== GATED (default deferral) run $i/$N ===================="
  one gated "" "$i"
  echo "==================== EAGER (ENABLE_TOOL_SEARCH=auto:100) run $i/$N ===================="
  one eager "ENABLE_TOOL_SEARCH=auto:100" "$i"
done
echo "########## TRACK3-TOGGLE-DONE ##########"
