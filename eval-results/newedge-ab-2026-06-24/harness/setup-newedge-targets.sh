#!/usr/bin/env bash
# Stage new-edge A/B targets into one DATASETS_DIR, pre-indexed with BOTH
# OmniWeave and codegraph (ab-benchmark.sh prewarms existing indexes, it does
# not reindex). Fresh rsync copies carry no stale .omniweave/.codegraph.
set -uo pipefail
ENGINE="/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave"
OWBIN="$ENGINE/dist/bin/omniweave.js"
CGBIN="$ENGINE/research/2026-06-23-codegraph-ecosystem/repos/codegraph/dist/bin/codegraph.js"
FIX="$ENGINE/eval-results/framework-parity-2026-06-24/dispatch-fixtures"
STAGE="$HOME/ow-newedge-targets"
DS="$HOME/ow-bench-datasets"
rm -rf "$STAGE"; mkdir -p "$STAGE"

stage() { # name src
  rsync -a --exclude .git --exclude node_modules --exclude dist \
    --exclude .omniweave --exclude .codegraph "$2/" "$STAGE/$1/"
}
stage rtk          "$FIX/rtk"
stage celery       "$FIX/celery"
stage sidekiq      "$FIX/sidekiq"
stage vue-realworld /tmp/ow-vue-realworld
stage requests     "$DS/lang-python"

for t in rtk celery sidekiq vue-realworld requests; do
  echo "=== indexing $t (OW + CG) ==="
  OMNIWEAVE_WASM_RELAUNCHED=1 node "$OWBIN" init "$STAGE/$t" </dev/null >/dev/null 2>&1 && echo "  OW ok" || echo "  OW FAIL"
  CODEGRAPH_WASM_RELAUNCHED=1 node "$CGBIN" init "$STAGE/$t" </dev/null >/dev/null 2>&1 && echo "  CG ok" || echo "  CG FAIL"
done
echo "=== staged + indexed in $STAGE ==="
ls "$STAGE"
