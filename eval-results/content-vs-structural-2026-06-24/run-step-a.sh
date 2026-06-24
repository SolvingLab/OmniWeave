#!/usr/bin/env bash
# Step A — the decisive content-vs-structural A/B (general-moat war plan §1 Step A).
#
# QUESTION it answers: when an agent must answer a CONTENT question (a string
# literal / pattern that is NOT a symbol in the graph), does a STRUCTURAL-only
# OmniWeave + Bash agent FAIL / REGRESS, or does it just spend ~1 extra tool call
# vs a hypothetical content index? If it ties on correctness and costs ~1 grep,
# the content index is an ECONOMY win (60-70% best-in-niche+superset route). If
# the structural agent flails / gets it wrong, it's an OUTCOME win (10-20% general
# route). We MEASURE; we never claim a correctness win.
#
# Three arms, same model (real MiMo), same questions:
#   omniweave : OmniWeave MCP (structural, symbol-only FTS today) + Bash/grep
#   codegraph : upstream codegraph MCP (also structural, no content index) + Bash
#   grep      : no MCP — Bash grep + Read only (the baseline every host already has)
#
# Fail-closed: a non-zero claude exit, empty JSONL, or missing result marks the run
# INVALID; INVALID runs are reported and excluded, never counted as a 0-tool win.
# Correctness graded deterministically: the question's gtRegex must match the
# agent's final answer text (case-insensitive). No correctness-win framing — the
# headline is tool-calls/turns at equal correctness.
#
# Usage: ANTHROPIC_BASE_URL=... ANTHROPIC_AUTH_TOKEN=... \
#        run-step-a.sh <repo> <codegraph-bin> <questions.json> [runs] [outdir]
set -uo pipefail

REPO="${1:?repo dir}"; CGBIN="${2:?codegraph bin}"; QJSON="${3:?questions.json}"; RUNS="${4:-2}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUTDIR="${5:-$HERE/results/raw}"
ENGINE="$(cd "$HERE/../.." && pwd)"
OWBIN="$ENGINE/dist/bin/omniweave.js"
MODEL="${MODEL:-mimo-v2.5-pro}"
command -v claude >/dev/null || { echo "claude CLI not on PATH"; exit 1; }
[ -f "$CGBIN" ] || { echo "codegraph bin missing: $CGBIN"; exit 1; }
[ -f "$OWBIN" ] || { echo "omniweave bin missing: $OWBIN (run npm run build)"; exit 1; }
[ -f "$QJSON" ] || { echo "questions json missing: $QJSON"; exit 1; }

mkdir -p "$OUTDIR"
WORK="$(mktemp -d /tmp/step-a-XXXX)"
TGT="$WORK/target"
rsync -a --exclude node_modules --exclude .git --exclude dist --exclude .omniweave --exclude .codegraph "$REPO/" "$TGT/"
echo "target: $TGT  | out: $OUTDIR  | model: $MODEL  | runs/arm/q: $RUNS"

echo "indexing target with OmniWeave + codegraph (one-time) ..."
OMNIWEAVE_WASM_RELAUNCHED=1 node "$OWBIN" init "$TGT" </dev/null >"$WORK/ow-index.log" 2>&1
node "$CGBIN" init "$TGT" </dev/null >"$WORK/cg-index.log" 2>&1
echo "  ow: $(grep -ioE '[0-9,]+ (nodes|files)' "$WORK/ow-index.log" | tail -2 | tr '\n' ' ')  cg: $(grep -ioE '[0-9,]+ (nodes|files)' "$WORK/cg-index.log" | tail -2 | tr '\n' ' ')"

printf '{"mcpServers":{}}' > "$WORK/mcp-none.json"
printf '{"mcpServers":{"omniweave":{"command":"env","args":["OMNIWEAVE_WASM_RELAUNCHED=1","node","%s","serve","--mcp","--path","%s"]}}}' "$OWBIN" "$TGT" > "$WORK/mcp-ow.json"
printf '{"mcpServers":{"codegraph":{"command":"env","args":["CODEGRAPH_WASM_RELAUNCHED=1","node","%s","serve","--mcp","--path","%s"]}}}' "$CGBIN" "$TGT" > "$WORK/mcp-cg.json"

cleanup(){ pkill -9 -f "serve --mcp --path $TGT" 2>/dev/null; }
trap cleanup EXIT

RESULTS="$OUTDIR/results.jsonl"
: > "$RESULTS"
INVALID=0; TOTAL=0

# parse+grade one run: emits a JSON record line. $1=jsonl $2=exit $3=gtRegex $4=qid $5=arm $6=run
grade(){
  node --no-warnings -e '
    const fs=require("fs");
    const [f,ex,gt,qid,arm,run]=[process.argv[1],Number(process.argv[2]||0),process.argv[3],process.argv[4],process.argv[5],Number(process.argv[6])];
    let reasons=[],read=0,grep=0,bash=0,owc=0,cgc=0,turns=0,ans="",hadResult=false;
    let txt=""; try{txt=fs.readFileSync(f,"utf8")}catch(e){reasons.push("no_jsonl")}
    if(!txt.trim())reasons.push("empty_jsonl");
    if(ex!==0)reasons.push("claude_exit="+ex);
    for(const line of txt.split("\n")){ if(!line.trim())continue; let o; try{o=JSON.parse(line)}catch{continue}
      if(o.type==="assistant"&&o.message&&Array.isArray(o.message.content)){ turns++;
        for(const b of o.message.content){
          if(b.type==="text"&&b.text.trim())ans=b.text;
          if(b.type==="tool_use"){const n=b.name||"";
            if(n==="Read")read++; else if(n==="Grep")grep++; else if(n==="Bash")bash++;
            else if(/mcp__omniweave__/.test(n))owc++; else if(/mcp__codegraph__/.test(n))cgc++;}
        }
      }
      if(o.type==="result"){hadResult=true; if(o.is_error)reasons.push("result_error"); if(o.result&&!ans)ans=String(o.result);}
    }
    if(!hadResult)reasons.push("no_result");
    const valid=reasons.length===0;
    let correct=false; try{correct=new RegExp(gt,"i").test(ans)}catch{}
    const tools=read+grep+bash+owc+cgc;
    console.log(JSON.stringify({qid,arm,run,valid,reasons,correct,tools,read,grep,bash,owc,cgc,turns,ans:ans.slice(0,500)}));
  ' "$1" "$2" "$3" "$4" "$5" "$6"
}

run_arm(){ # $1=arm-label $2=cfg $3=qid $4=prompt $5=gtRegex
  local arm="$1" cfg="$2" qid="$3" prompt="$4" gt="$5"
  cleanup; sleep 1
  if grep -q '"omniweave"' "$cfg"; then OMNIWEAVE_DAEMON_IDLE_TIMEOUT_MS=1800000 OMNIWEAVE_WASM_RELAUNCHED=1 node "$OWBIN" serve --mcp --path "$TGT" </dev/null >/dev/null 2>&1 & fi
  if grep -q '"codegraph"' "$cfg"; then CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS=1800000 CODEGRAPH_WASM_RELAUNCHED=1 node "$CGBIN" serve --mcp --path "$TGT" </dev/null >/dev/null 2>&1 & fi
  sleep 3
  for i in $(seq 1 "$RUNS"); do
    TOTAL=$((TOTAL+1))
    local jf="$OUTDIR/$qid-$arm-$i.jsonl"
    ( cd "$TGT" && timeout 300 claude -p "$prompt" --output-format stream-json --verbose \
        --permission-mode bypassPermissions --model "$MODEL" --max-budget-usd 3 \
        ${SETTINGS:+--settings "$SETTINGS"} \
        --strict-mcp-config --mcp-config "$cfg" </dev/null > "$jf" 2>"$OUTDIR/$qid-$arm-$i.err" )
    local ex=$?
    local rec; rec=$(grade "$jf" "$ex" "$gt" "$qid" "$arm" "$i")
    echo "$rec" >> "$RESULTS"
    echo "  [$qid $arm #$i] $(printf '%s' "$rec" | node --no-warnings -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(`valid=${o.valid} correct=${o.correct} tools=${o.tools}(ow${o.owc}/cg${o.cgc}/grep${o.grep}/bash${o.bash}/read${o.read}) turns=${o.turns} ${o.reasons.join(",")}`)')"
    printf '%s' "$rec" | grep -q '"valid":false' && INVALID=$((INVALID+1))
  done
}

# Drive every question across the three arms. Tab-separated (questions/regex have
# no tabs); a temp TSV avoids subshell-scoping the INVALID/TOTAL counters.
TSV="$WORK/questions.tsv"
node --no-warnings -e 'const q=require(require("path").resolve(process.argv[1]));for(const x of q)process.stdout.write(x.id+"\t"+x.gtRegex+"\t"+x.question+"\n")' "$QJSON" > "$TSV"
ARMS="${ARMS:-omniweave codegraph grep}"
while IFS=$'\t' read -r qid gt prompt; do
  [ -z "$qid" ] && continue
  echo "== Q $qid =="
  case " $ARMS " in *" omniweave "*) run_arm omniweave "$WORK/mcp-ow.json" "$qid" "$prompt" "$gt";; esac
  case " $ARMS " in *" codegraph "*) run_arm codegraph "$WORK/mcp-cg.json" "$qid" "$prompt" "$gt";; esac
  case " $ARMS " in *" grep "*) run_arm grep "$WORK/mcp-none.json" "$qid" "$prompt" "$gt";; esac
done < "$TSV"

echo "---- INVALID $INVALID / $TOTAL ----"
if [ "$INVALID" -gt 0 ]; then
  echo "###### NOTE: $INVALID/$TOTAL runs INVALID (excluded from analysis). Raw: $OUTDIR"
fi
echo "results: $RESULTS"
