#!/usr/bin/env bash
# Cross-language parity matrix: index each real repo with BOTH OmniWeave and
# upstream codegraph, then compare node/edge counts and per-kind edge histograms.
#
# Scientific point: the two tools must AGREE on the 12 standard structural edge
# kinds across every language (OmniWeave is a fork — it must not regress the
# base). The ONLY differences should be OmniWeave's 4 bridge kinds (crossLang /
# produces / consumes / invokes) and the S4 dispatch overrides, which appear
# only in polyglot / workflow / R-S4 repos. A divergence on a standard kind in a
# same-language repo would be a regression, not a feature.
#
# Usage: lang-parity.sh <dir-of-cloned-repos> | <repo-dir> [more repo dirs...]
set -uo pipefail
ENGINE="$(cd "$(dirname "$0")/../../.." && pwd)"
OWBIN="$ENGINE/dist/bin/omniweave.js"
CGBIN="${CGBIN:-$ENGINE/research/2026-06-23-codegraph-ecosystem/repos/codegraph/dist/bin/codegraph.js}"
if [ "$#" -lt 1 ]; then
  echo "usage: lang-parity.sh <dir-of-cloned-repos> | <repo-dir> [more repo dirs...]" >&2
  exit 2
fi
shopt -s nullglob
REPOS=()
for arg in "$@"; do
  if [ -d "$arg/.git" ]; then
    REPOS+=("$arg")
    continue
  fi
  for d in "$arg"/*/; do
    [ -d "$d/.git" ] && REPOS+=("$d")
  done
done
if [ "${#REPOS[@]}" -eq 0 ]; then
  echo "no git repos found in: $*" >&2
  exit 2
fi
OUT="${OUT:-$ENGINE/scripts/agent-eval/.parity-out}"
mkdir -p "$OUT"; : > "$OUT/parity.jsonl"

for d in "${REPOS[@]}"; do
  name="$(basename "$d")"
  echo "=== $name : indexing both ==="
  OMNIWEAVE_WASM_RELAUNCHED=1 node "$OWBIN" init "$d" </dev/null >/dev/null 2>&1
  node "$CGBIN" init "$d" </dev/null >/dev/null 2>&1
  node --no-warnings -e '
    const {DatabaseSync}=require("node:sqlite"); const [dir,name]=[process.argv[1],process.argv[2]];
    function g(db){ try{const d=new DatabaseSync(db,{readOnly:true});
      const nodes=d.prepare("select count(*) c from nodes").get().c;
      const edges=d.prepare("select count(*) c from edges").get().c;
      const ek={}; for(const r of d.prepare("select kind,count(*) c from edges group by kind").all()) ek[r.kind]=r.c;
      d.close(); return {nodes,edges,ek};
    }catch(e){return {err:e.message}} }
    const ow=g(dir+"/.omniweave/omniweave.db"), cg=g(dir+"/.codegraph/codegraph.db");
    const STD=["contains","calls","imports","exports","extends","implements","references","type_of","returns","instantiates","overrides","decorates"];
    const BRIDGE=["crossLang","produces","consumes","invokes"];
    // standard-edge divergence: sum |ow-cg| over standard kinds (excl. overrides which S4 affects)
    let stdDiff=0; for(const k of STD){ if(k==="overrides")continue; stdDiff+=Math.abs((ow.ek?.[k]||0)-(cg.ek?.[k]||0)); }
    const owBridge=BRIDGE.reduce((a,k)=>a+(ow.ek?.[k]||0),0);
    const cgBridge=BRIDGE.reduce((a,k)=>a+(cg.ek?.[k]||0),0);
    const owOverrides=ow.ek?.overrides||0, cgOverrides=cg.ek?.overrides||0;
    console.log(JSON.stringify({name,ow_nodes:ow.nodes,cg_nodes:cg.nodes,ow_edges:ow.edges,cg_edges:cg.edges,std_calls_diff:Math.abs((ow.ek?.calls||0)-(cg.ek?.calls||0)),std_total_diff:stdDiff,ow_bridge:owBridge,cg_bridge:cgBridge,ow_overrides:owOverrides,cg_overrides:cgOverrides,ow_err:ow.err||null,cg_err:cg.err||null}));
  ' "$d" "$name" | tee -a "$OUT/parity.jsonl"
done
echo "PARITY_DONE → $OUT/parity.jsonl"
