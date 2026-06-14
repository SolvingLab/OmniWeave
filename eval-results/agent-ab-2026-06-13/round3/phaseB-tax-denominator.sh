#!/usr/bin/env bash
# Phase B part 2 — (A) without-omniweave baseline on the SAME simple question
# (the tax denominator), plus (C-then-B) a reverse-order re-run of deferral
# off/on to rule out cache/order artifacts in the cost inversion.
# Inherits harness auth proxy verbatim (never clear HTTP_PROXY).
set -uo pipefail
REPO="${1:?repo}"; Q="${2:?question}"; OUT="${3:?outdir}"
CG_BIN="$(command -v omniweave)"
HARNESS=/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave/scripts/agent-eval
mkdir -p "$OUT"
cat > "$OUT/mcp-omniweave.json" <<JSON
{"mcpServers":{"omniweave":{"command":"$CG_BIN","args":["serve","--mcp","--path","$REPO"]}}}
JSON
echo '{"mcpServers":{}}' > "$OUT/mcp-empty.json"

run() {
  local label="$1" cfg="$2"
  echo "############ [$label] ENABLE_TOOL_SEARCH='${ENABLE_TOOL_SEARCH:-<unset>}' ############"
  ( cd "$REPO" && claude -p "$Q" \
      --output-format stream-json --verbose --permission-mode bypassPermissions \
      --model "${MODEL:-sonnet}" --effort "${EFFORT:-high}" --max-budget-usd 4 \
      --strict-mcp-config --mcp-config "$cfg" \
      > "$OUT/run-$label.jsonl" 2>"$OUT/run-$label.err" )
  echo "exit $? -> ($(wc -l < "$OUT/run-$label.jsonl" | tr -d ' ') lines)"
  node "$HARNESS/parse-run.mjs" "$OUT/run-$label.jsonl" 2>&1 | grep -E 'by type|Result:|tokens:' || true
  echo
}

# (A) without-omniweave baseline (grep/read only) — the tax denominator
unset ENABLE_TOOL_SEARCH
run "without-omniweave" "$OUT/mcp-empty.json"

# (C') reverse-order confirmation: deferral OFF first this time
export ENABLE_TOOL_SEARCH=auto:100
run "confirm-deferral-off" "$OUT/mcp-omniweave.json"

# (B') then deferral ON
unset ENABLE_TOOL_SEARCH
run "confirm-deferral-on" "$OUT/mcp-omniweave.json"

echo "############ PHASE-B TAX-DENOMINATOR COMPLETE ############"
