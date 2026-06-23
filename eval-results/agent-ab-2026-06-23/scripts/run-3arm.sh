#!/usr/bin/env bash
# 3-arm A/B for ONE task: omniweave-NEW vs omniweave-OLD(fc91305) vs grep.
# MiMo backend (env sourced by caller). auto:100 standard mode so MiMo can reach MCP tools.
# Usage: run-3arm.sh "<question>" <label> [N]
set -uo pipefail
Q="$1"; LABEL="$2"; N="${3:-2}"
REPO="/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave"
SCRATCH="$(cd "$(dirname "$0")" && pwd)"
NEW_BIN="$(command -v omniweave)"                              # HEAD (npm-linked dist)
OLD_BIN="$SCRATCH/ow-prehardening/dist/bin/omniweave.js"       # fc91305
CLAUDE_BIN="/Users/liuzaoqu/.local/bin/claude"
OUT="$SCRATCH/r7/$LABEL"; mkdir -p "$OUT"
HARNESS="$REPO/scripts/agent-eval"

cat > "$OUT/mcp-new.json" <<JSON
{"mcpServers":{"omniweave":{"command":"$NEW_BIN","args":["serve","--mcp","--path","$REPO"]}}}
JSON
cat > "$OUT/mcp-old.json" <<JSON
{"mcpServers":{"omniweave":{"command":"node","args":["$OLD_BIN","serve","--mcp","--path","$REPO"]}}}
JSON
echo '{"mcpServers":{}}' > "$OUT/mcp-empty.json"

echo "###### task[$LABEL] N=$N   NEW=$($NEW_BIN --version)  OLD=$(node "$OLD_BIN" --version)"
echo "###### Q: $Q"

one() { # arm cfg rid
  local arm="$1" cfg="$2" rid="$3"
  local f="$OUT/$arm-r$rid.jsonl"
  ( cd "$REPO" && "$CLAUDE_BIN" -p "$Q" \
      --output-format stream-json --verbose \
      --permission-mode bypassPermissions \
      --model mimo-v2.5-pro --max-budget-usd 2 \
      --strict-mcp-config --mcp-config "$cfg" \
      > "$f" 2>"$OUT/$arm-r$rid.err" )
  echo "[$arm r$rid] exit $? -> $(wc -l < "$f" | tr -d ' ') lines"
  node "$HARNESS/parse-run.mjs" "$f" 2>&1 | grep -E "by type|Result:|tokens:|omniweave tools" | sed 's/^/    /'
}

for i in $(seq 1 "$N"); do
  echo "==== run $i/$N ===="
  one new   "$OUT/mcp-new.json"   "$i"
  one old   "$OUT/mcp-old.json"   "$i"
  one grep  "$OUT/mcp-empty.json" "$i"
done
echo "######## DONE [$LABEL] ########"
