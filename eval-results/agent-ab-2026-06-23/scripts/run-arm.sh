#!/usr/bin/env bash
# run-arm.sh <repo> "<question>" <mcp-config> <out.jsonl>
# Drives one headless claude -p run against MiMo. Inherits MiMo env from caller.
set -uo pipefail
REPO="$1"; Q="$2"; CFG="$3"; OUT="$4"
CLAUDE_BIN="/Users/liuzaoqu/.local/bin/claude"
# Resolve OUT/CFG to absolute so the inner `cd "$REPO"` doesn't misplace them.
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
ERR="${OUT%.jsonl}.err"
case "$CFG" in /*) ;; *) CFG="$(cd "$(dirname "$CFG")" && pwd)/$(basename "$CFG")";; esac
( cd "$REPO" && "$CLAUDE_BIN" -p "$Q" \
    --output-format stream-json --verbose \
    --permission-mode bypassPermissions \
    --model mimo-v2.5-pro \
    --max-budget-usd 2 \
    --strict-mcp-config --mcp-config "$CFG" \
    > "$OUT" 2>"$ERR" )
echo "exit=$? lines=$(wc -l < "$OUT" | tr -d ' ') -> $OUT"
