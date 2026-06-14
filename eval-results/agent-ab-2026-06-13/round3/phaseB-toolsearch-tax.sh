#!/usr/bin/env bash
# Phase B — quantify the ToolSearch form-factor tax and the effect of disabling
# deferral. Runs the SAME with-arm (omniweave MCP) question TWICE:
#   (1) baseline  — default env  → ToolSearch deferral ON (forced ToolSearch 1st call)
#   (2) optimized — ENABLE_TOOL_SEARCH=auto:100 → standard mode, deferral OFF (eager load)
# Only the with-arm matters: the without-arm has no MCP tools so deferral never bites it.
# Inherits the harness auth proxy verbatim (NEVER clear HTTP_PROXY — 401 trap).
#
# Usage: phaseB-toolsearch-tax.sh <repo-path> "<question>" <out-dir>
set -uo pipefail
REPO="${1:?repo}"; Q="${2:?question}"; OUT="${3:?outdir}"
CG_BIN="$(command -v omniweave)"
HARNESS=/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave/scripts/agent-eval
mkdir -p "$OUT"
cat > "$OUT/mcp-omniweave.json" <<JSON
{"mcpServers":{"omniweave":{"command":"$CG_BIN","args":["serve","--mcp","--path","$REPO"]}}}
JSON

run() {
  local label="$1"; shift
  echo "############ [$label] ENABLE_TOOL_SEARCH='${ENABLE_TOOL_SEARCH:-<unset>}' ############"
  ( cd "$REPO" && claude -p "$Q" \
      --output-format stream-json --verbose \
      --permission-mode bypassPermissions \
      --model "${MODEL:-sonnet}" --effort "${EFFORT:-high}" \
      --max-budget-usd 4 \
      --strict-mcp-config --mcp-config "$OUT/mcp-omniweave.json" \
      > "$OUT/run-$label.jsonl" 2>"$OUT/run-$label.err" )
  echo "exit $? -> $OUT/run-$label.jsonl ($(wc -l < "$OUT/run-$label.jsonl" | tr -d ' ') lines)"
  tail -2 "$OUT/run-$label.err" 2>/dev/null
  node "$HARNESS/parse-run.mjs" "$OUT/run-$label.jsonl" 2>&1 | grep -E 'tools exposed|by type|Result:|tokens:|ToolSearch' || true
  echo
}

# (1) baseline — deferral ON (default; do not set ENABLE_TOOL_SEARCH)
unset ENABLE_TOOL_SEARCH
run "with-deferral-on"

# (2) optimized — deferral OFF (standard mode)
export ENABLE_TOOL_SEARCH=auto:100
run "with-deferral-off"

echo "############ PHASE-B TOOLSEARCH-TAX COMPLETE ############"
