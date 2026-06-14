#!/usr/bin/env bash
# Round 5 Track B — query-type routing before/after A/B.
# Runs a fixed MIXED question set (single-point ×2 / reverse / transitive /
# cross-process, multi-language multi-repo) through run-round4.sh.
#
# Usage: run-trackB.sh <phase: before|after> <N> [arms: both|with]
#   phase  — just the output-label prefix + a sanity echo of the live build's
#            server-instructions hash (so before/after provenance is auditable).
#   N      — runs per arm (>=3).
#   arms   — "both" runs with+without (use in `before` to capture the grep baseline);
#            "with" runs only the omniweave arm (use in `after`: the grep arm is
#            build-independent, no need to re-burn it).
set -uo pipefail
PHASE="${1:?usage: run-trackB.sh <before|after> <N> [both|with]}"
N="${2:-3}"
ARMS="${3:-both}"
ROOT=/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave
RUNNER="$ROOT/eval-results/agent-ab-2026-06-13/round4/run-round4.sh"
CORP=/tmp/omniweave-corpus
export ROUND4_OUT=/tmp/agent-eval-r5/trackB-$PHASE
export MODEL=sonnet EFFORT=high

# Provenance: which server-instructions is compiled into the live build right now.
echo "###### Track B phase=$PHASE N=$N arms=$ARMS"
echo "###### server-instructions sha: $(shasum "$ROOT/dist/mcp/server-instructions.js" 2>/dev/null | cut -c1-12)"
echo "###### omniweave: $(omniweave --version 2>/dev/null)"

# question set: label | repo | question
run_q() {
  local label="$1" repo="$2" q="$3"
  echo "==================================================================="
  echo "###### Q[$label] @ $repo"
  if [ "$ARMS" = "with" ]; then
    # with-only: build a one-arm config inline by reusing run-round4.sh but the
    # without arm is cheap grep; simplest is to run the full runner and ignore
    # the without outputs. To truly skip, we still call the runner (it does both)
    # — acceptable: extra grep runs are cheap and give variance. Override here if needed.
    bash "$RUNNER" "$repo" "$q" "$label" "$N" 2>&1 | tail -40
  else
    bash "$RUNNER" "$repo" "$q" "$label" "$N" 2>&1 | tail -40
  fi
}

run_q "tb-single-ts"  "$CORP/ky" \
  'Where is the HTTPError class defined (give the file:line), and what arguments does its constructor take? Answer just that.'

run_q "tb-single-r"   "$CORP/DESeq2" \
  'Where is the function nbinomWaldTest defined (give the file:line) and what is its full signature? Answer just that.'

run_q "tb-reverse"    "$CORP/django" \
  'List every function or method that calls iri_to_uri (the one in django/utils/encoding.py). Give each caller with its file:line.'

run_q "tb-transitive" "$CORP/django" \
  'escape_uri_path (django/utils/encoding.py) changes its output. Give the COMPLETE transitive blast radius WITHIN django/http/request.py: every HttpRequest method affected directly or indirectly, plus the call chain.'

run_q "tb-xproc"      "$CORP/quarTeT" \
  'Running quartet.py with the AssemblyMapper (am) subcommand, which OTHER repo Python scripts get executed as subprocesses, directly or transitively? List each script and the path by which it is reached.'

echo "############################## TRACK B [$PHASE] COMPLETE ##############################"
