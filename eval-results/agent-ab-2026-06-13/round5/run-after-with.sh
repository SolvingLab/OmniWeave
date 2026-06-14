#!/usr/bin/env bash
# Round 5 Track B — AFTER phase, WITH-arm only.
# The without-arm (grep) is build-independent, so it is NOT re-run; the BEFORE
# phase's without runs are the baseline. This runs only the omniweave arm on the
# ROUTING build, so before-with vs after-with isolates the server-instructions
# routing change as the single variable. Inherits the harness auth proxy — DO NOT clear.
set -uo pipefail
N="${1:-3}"
ROOT=/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave
CG_BIN="$(command -v omniweave)"
CORP=/tmp/omniweave-corpus
OUTROOT=/tmp/agent-eval-r5/trackB-after
HARNESS="$ROOT/scripts/agent-eval"
mkdir -p "$OUTROOT"

echo "###### Track B AFTER (with-only) N=$N"
echo "###### server-instructions sha: $(shasum "$ROOT/dist/mcp/server-instructions.js" | cut -c1-12)"
echo "###### omniweave: $($CG_BIN --version)"

one() {  # label repo question
  local label="$1" repo="$2" q="$3"
  local out="$OUTROOT/$label"; mkdir -p "$out"
  cat > "$out/mcp-omniweave.json" <<JSON
{"mcpServers":{"omniweave":{"command":"$CG_BIN","args":["serve","--mcp","--path","$repo"]}}}
JSON
  echo "=================== Q[$label] @ $repo ==================="
  for i in $(seq 1 "$N"); do
    local f="$out/with-r$i.jsonl"
    ( cd "$repo" && claude -p "$q" \
        --output-format stream-json --verbose \
        --permission-mode bypassPermissions \
        --model sonnet --effort high --max-budget-usd 4 \
        --strict-mcp-config --mcp-config "$out/mcp-omniweave.json" \
        > "$f" 2>"$out/with-r$i.err" )
    echo "[with r$i] exit $? -> $(wc -l < "$f" | tr -d ' ') lines"
    node "$HARNESS/parse-run.mjs" "$f" 2>&1 | grep -E "by type|Result|cost" | sed 's/^/    /'
  done
}

one "tb-single-ts"  "$CORP/ky" \
  'Where is the HTTPError class defined (give the file:line), and what arguments does its constructor take? Answer just that.'
one "tb-single-r"   "$CORP/DESeq2" \
  'Where is the function nbinomWaldTest defined (give the file:line) and what is its full signature? Answer just that.'
one "tb-reverse"    "$CORP/django" \
  'List every function or method that calls iri_to_uri (the one in django/utils/encoding.py). Give each caller with its file:line.'
one "tb-transitive" "$CORP/django" \
  'escape_uri_path (django/utils/encoding.py) changes its output. Give the COMPLETE transitive blast radius WITHIN django/http/request.py: every HttpRequest method affected directly or indirectly, plus the call chain.'
one "tb-xproc"      "$CORP/quarTeT" \
  'Running quartet.py with the AssemblyMapper (am) subcommand, which OTHER repo Python scripts get executed as subprocesses, directly or transitively? List each script and the path by which it is reached.'

echo "############################## TRACK B AFTER COMPLETE ##############################"
