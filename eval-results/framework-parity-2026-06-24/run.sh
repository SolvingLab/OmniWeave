#!/usr/bin/env bash
# Index a real framework app with BOTH OmniWeave and codegraph, then report the
# node/edge parity (measure.mjs). The ⑥-debt verification: a superset fork must
# not extract fewer store-action nodes or emit fewer dispatch edges than CG on a
# real Pinia/Vuex/Redux app.
#
# IMPORTANT: run `npm run build` first so OmniWeave's dist reflects the latest
# synthesizer/extraction work before this measures it.
#
# Usage: run.sh <app-dir> [label]
set -uo pipefail
APP="${1:?app dir}"; LABEL="${2:-$(basename "$APP")}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ENGINE="$(cd "$HERE/../.." && pwd)"
OWBIN="$ENGINE/dist/bin/omniweave.js"
CGBIN="${CGBIN:-$ENGINE/research/2026-06-23-codegraph-ecosystem/repos/codegraph/dist/bin/codegraph.js}"
[ -f "$OWBIN" ] || { echo "omniweave bin missing: $OWBIN (npm run build)"; exit 1; }
[ -f "$CGBIN" ] || { echo "codegraph bin missing: $CGBIN"; exit 1; }

WORK="$(mktemp -d /tmp/fw-parity-XXXX)"
OW_T="$WORK/ow"; CG_T="$WORK/cg"
rsync -a --exclude node_modules --exclude .git --exclude dist --exclude .omniweave --exclude .codegraph "$APP/" "$OW_T/"
rsync -a --exclude node_modules --exclude .git --exclude dist --exclude .omniweave --exclude .codegraph "$APP/" "$CG_T/"
echo "[$LABEL] indexing with OmniWeave + codegraph ..."
OMNIWEAVE_WASM_RELAUNCHED=1 node "$OWBIN" init "$OW_T" </dev/null >"$WORK/ow.log" 2>&1
node "$CGBIN" init "$CG_T" </dev/null >"$WORK/cg.log" 2>&1

OWDB="$(ls "$OW_T"/.omniweave/*.db 2>/dev/null | grep -E 'omniweave\.db$' | head -1)"
CGDB="$(ls "$CG_T"/.codegraph/*.db 2>/dev/null | grep -Ev 'graph\.db$' | head -1)"
[ -z "$CGDB" ] && CGDB="$(ls "$CG_T"/.codegraph/*.db 2>/dev/null | head -1)"
echo "ow db: $OWDB"
echo "cg db: $CGDB"
echo ""
echo "# $LABEL"
node "$HERE/measure.mjs" "$OWDB" "$CGDB"
echo ""
echo "(work dir $WORK — remove when done)"
