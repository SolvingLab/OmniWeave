#!/usr/bin/env bash
# Round 6 — Track 1 AFTER: with-arm only, on the NEW build (callers fix).
# without-arm baseline is reused from the BEFORE run (grep doesn't use MCP, so
# it's identical before/after). Inherits the harness auth proxy — DO NOT clear.
#
# PRECONDITION: dist rebuilt with the callers fix, and pgrep -f 'claude -p' == 0
# before launch (no stale before-run MCP server polluting the after measurement).
#
# Usage: bash run-track1-after.sh   (N via $N, default 3)
set -uo pipefail
CG_BIN="$(command -v omniweave)"
REPO=/tmp/omniweave-corpus/vscode
N="${N:-3}"
MODEL="${MODEL:-sonnet}" EFFORT="${EFFORT:-high}"
HARNESS="/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave/scripts/agent-eval"
OUT=/tmp/agent-eval-r6/callers-cap-after
mkdir -p "$OUT"
Q="How many distinct functions or methods call \`checkProposedApiEnabled\` in this codebase? Give the exact total count, and list each distinct caller with its file path. Be precise about the total — I need the real number of distinct callers."

cat > "$OUT/mcp-omniweave.json" <<JSON
{"mcpServers":{"omniweave":{"command":"$CG_BIN","args":["serve","--mcp","--path","$REPO"]}}}
JSON

echo "########## TRACK1 AFTER (with-only, N=$N, $MODEL/$EFFORT) ##########"
echo "omniweave=$CG_BIN ($($CG_BIN --version))  repo=$REPO"

for i in $(seq 1 "$N"); do
  out="$OUT/with-r$i.jsonl" err="$OUT/with-r$i.err"
  ( cd "$REPO" && claude -p "$Q" \
      --output-format stream-json --verbose \
      --permission-mode bypassPermissions \
      --model "$MODEL" --effort "$EFFORT" \
      --max-budget-usd 4 \
      --strict-mcp-config --mcp-config "$OUT/mcp-omniweave.json" \
      > "$out" 2>"$err" )
  echo "[with r$i] exit $? -> $out ($(wc -l < "$out" | tr -d ' ') lines)"
  node "$HARNESS/parse-run.mjs" "$out" 2>&1 | sed 's/^/    /' || true
done
echo "########## TRACK1-AFTER-DONE ##########"
