#!/usr/bin/env bash
# Round 4 — statistical A/B runner: N runs per arm for ONE repo+question.
# Same protocol as run-all.sh (OmniWeave MCP is the ONLY variable; both arms keep
# built-in grep/read/bash), but loops N times each arm so we can report variance
# (Track 3: statistical rigor). Inherits the harness auth proxy — DO NOT clear it.
#
# Usage: run-round4.sh <repo-path> "<question>" <label> [N] [MODEL] [EFFORT]
# Env:   CG_BIN  omniweave binary (default: command -v omniweave)
#        ROUND4_OUT  output dir (default: /tmp/agent-eval-r4)
set -uo pipefail

REPO="${1:?usage: run-round4.sh <repo-path> \"<question>\" <label> [N] [MODEL] [EFFORT]}"
Q="${2:?question required}"
LABEL="${3:?label required}"
N="${4:-3}"
MODEL="${5:-${MODEL:-sonnet}}"
EFFORT="${6:-${EFFORT:-high}}"
CG_BIN="${CG_BIN:-$(command -v omniweave)}"
OUT="${ROUND4_OUT:-/tmp/agent-eval-r4}/$LABEL"
HARNESS="/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave/scripts/agent-eval"
mkdir -p "$OUT"

[ -n "$CG_BIN" ] || { echo "no omniweave binary on PATH (set CG_BIN)"; exit 1; }
[ -d "$REPO/.omniweave" ] || { echo "no .omniweave index at $REPO — index it first"; exit 1; }

cat > "$OUT/mcp-omniweave.json" <<JSON
{"mcpServers":{"omniweave":{"command":"$CG_BIN","args":["serve","--mcp","--path","$REPO"]}}}
JSON
echo '{"mcpServers":{}}' > "$OUT/mcp-empty.json"

echo "###### omniweave: $CG_BIN ($($CG_BIN --version 2>/dev/null))"
echo "###### repo:      $REPO"
echo "###### label:     $LABEL   N=$N   model=$MODEL effort=$EFFORT"
echo "###### question:  $Q"
echo

one() {  # arm-label  mcp-config  run-id
  local arm="$1" cfg="$2" rid="$3"
  local out="$OUT/$arm-r$rid.jsonl" err="$OUT/$arm-r$rid.err"
  ( cd "$REPO" && claude -p "$Q" \
      --output-format stream-json --verbose \
      --permission-mode bypassPermissions \
      --model "$MODEL" --effort "$EFFORT" \
      --max-budget-usd 4 \
      --strict-mcp-config --mcp-config "$cfg" \
      > "$out" 2>"$err" )
  echo "[$arm r$rid] exit $? -> $out ($(wc -l < "$out" | tr -d ' ') lines)"
  tail -1 "$err" 2>/dev/null | head -c 200; echo
  node "$HARNESS/parse-run.mjs" "$out" 2>&1 | sed 's/^/    /' || true
}

for i in $(seq 1 "$N"); do
  echo "==================== WITH-arm run $i/$N ===================="
  one with    "$OUT/mcp-omniweave.json" "$i"
  echo "==================== WITHOUT-arm run $i/$N ===================="
  one without "$OUT/mcp-empty.json" "$i"
done
echo "############################## ROUND4 [$LABEL] COMPLETE ##############################"
