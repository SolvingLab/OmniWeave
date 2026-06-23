#!/usr/bin/env bash
# Deterministic output-diff: same honesty-trigger queries, current dist vs pre-hardening dist.
# Both read the SAME (schema-identical) index. Read-only CLI commands only.
set -uo pipefail
REPO="/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave"
NEW="$REPO/dist/bin/omniweave.js"                 # HEAD (hardened)
OLD="$(dirname "$0")/ow-prehardening/dist/bin/omniweave.js"   # fc91305 (pre-hardening)
OUT="$(dirname "$0")/diff-out"
mkdir -p "$OUT"

DB="$REPO/.omniweave/omniweave.db"
mt_before=$(stat -f %m "$DB")

run() {  # id  subcmd  args...
  local id="$1"; shift
  node "$NEW" "$@" --path "$REPO" > "$OUT/$id.new.txt" 2>"$OUT/$id.new.err" || true
  node "$OLD" "$@" --path "$REPO" > "$OUT/$id.old.txt" 2>"$OUT/$id.old.err" || true
  local n_chars o_chars
  n_chars=$(wc -c < "$OUT/$id.new.txt" | tr -d ' ')
  o_chars=$(wc -c < "$OUT/$id.old.txt" | tr -d ' ')
  printf "%-22s NEW=%6sc  OLD=%6sc\n" "$id" "$n_chars" "$o_chars"
}

echo "### honesty-trigger output diff: NEW(HEAD) vs OLD(fc91305) ###"
run "empty-missing"     explore "zzqxqNoSuchSymbolHere12345"
run "snapshot-ordinary" explore "ToolHandler"
run "callers-honesty"   callers handleExplore
run "impact-honesty"    impact ToolHandler
run "node-trail"        node handleExplore --file src/mcp/tools.ts

mt_after=$(stat -f %m "$DB")
echo ""
echo "DB mtime before=$mt_before after=$mt_after  $([ "$mt_before" = "$mt_after" ] && echo 'UNCHANGED (read-only OK)' || echo 'CHANGED ⚠️')"
