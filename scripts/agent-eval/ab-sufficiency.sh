#!/usr/bin/env bash
# Sufficiency A/B: on a real understanding/flow question, WHEN the agent uses
# omniweave (explore/node), does it still Read? Premise under test: explore/node
# return source WITH line numbers, so a Read should not be needed.
#
# WITH omniweave (pre-warmed daemon, reliable nested attach) vs WITHOUT (empty
# MCP, Read/Grep only), N runs each, on a throwaway copy of the repo. Reports
# explore/node vs Read/Grep, and LISTS the files Read in the WITH arm so a true
# sufficiency gap (an indexed source file) is distinguishable from out-of-scope
# (configs, docs, a file omniweave didn't index).
#
# Usage: ab-sufficiency.sh <indexed-repo> "<question>" [runs-per-arm]
# Env: AGENT_EVAL_OUT (default: /tmp/ab-sufficiency)
set -uo pipefail

analyze(){
  node - "$1" "${2:-/dev/null}" "${3:-0}" <<'NODE'
    const fs=require("fs");
    const jsonlPath=process.argv[2];
    const errPath=process.argv[3];
    const claudeExit=Number(process.argv[4]||0);
    const jsonl=fs.existsSync(jsonlPath)?fs.readFileSync(jsonlPath,"utf8"):"";
    const stderr=fs.existsSync(errPath)?fs.readFileSync(errPath,"utf8"):"";
    const L=jsonl.split("\n").filter(Boolean);
    let ex=0,nf=0,ns=0,oc=0,gr=0,exposed="?";const reads=[];
    let sawResult=false;const reasons=[];
    const addReason=(r)=>{if(r&&!reasons.includes(r))reasons.push(r);};
    if(claudeExit!==0)addReason(`claude_exit=${claudeExit}`);
    if(L.length===0)addReason("empty_jsonl");
    const scanErrorText=(s)=>{
      const t=String(s||"").toLowerCase();
      if(t.includes("authentication_failed"))addReason("authentication_failed");
      if(t.includes("invalid bearer token"))addReason("invalid_bearer_token");
      if(/\b401\b/.test(t)||t.includes("unauthorized"))addReason("http_401_unauthorized");
      if(t.includes("api_error_status"))addReason("api_error_status_text");
      if(/is_error['"]?\s*:\s*true/.test(t))addReason("is_error=true");
      if(/\bapi[_ -]?error\b/.test(t))addReason("api_error_text");
    };
    const inspect=(v)=>{
      if(!v||typeof v!=="object")return;
      if(v.is_error===true)addReason("is_error=true");
      if(Object.prototype.hasOwnProperty.call(v,"api_error_status"))addReason(`api_error_status=${v.api_error_status}`);
      for(const [k,val] of Object.entries(v)){
        const key=k.toLowerCase();
        if((key==="error"||key==="message"||key==="result"||key==="subtype"||key==="code"||key==="type")&&typeof val==="string")scanErrorText(val);
        if(val&&typeof val==="object")inspect(val);
      }
    };
    scanErrorText(stderr);
    for(const l of L){try{const o=JSON.parse(l);inspect(o);
      if(o.type==="result"){sawResult=true;if(o.subtype&&/error|fail/i.test(String(o.subtype)))addReason(`result_${o.subtype}`);}
      if(o.type==="system"&&o.subtype==="init")exposed=(o.tools||[]).filter(t=>/omniweave/.test(t)).length;
      for(const b of (o.message?.content||[])){if(b.type!=="tool_use")continue;
        if(b.name==="mcp__omniweave__omniweave_explore")ex++;
        else if(b.name==="mcp__omniweave__omniweave_node"){if(b.input&&b.input.symbol)ns++;else nf++;}
        else if(/mcp__omniweave__/.test(b.name))oc++;
        else if(b.name==="Read")reads.push((b.input?.file_path||"").split("/").pop());
        else if(b.name==="Grep")gr++;
      }}catch{}}
    if(!sawResult)addReason("missing_result");
    if(reasons.length){
      console.log(`    INVALID: ${reasons.join(", ")} | skipped tool-count A/B analysis`);
      process.exit(1);
    }
    console.log(`    explore=${ex} node[sym]=${ns} node[file]=${nf} other_cg=${oc} | Read=${reads.length}${reads.length?" ("+reads.join(", ")+")":""} Grep=${gr}  [cg exposed=${exposed}]`);
NODE
}

if [ "${OMNIWEAVE_AB_SUFFICIENCY_ANALYZE_ONLY:-}" = "1" ]; then
  analyze "${1:?jsonl required}" "${2:-/dev/null}" "${3:-0}"
  exit $?
fi

REPO="${1:?usage: ab-sufficiency.sh <indexed-repo> \"<question>\" [runs]}"
Q="${2:?question required}"
RUNS="${3:-2}"
ENGINE="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$ENGINE/dist/bin/omniweave.js"
OUT="${AGENT_EVAL_OUT:-/tmp/ab-sufficiency}"
TGT="$OUT/target"
command -v claude >/dev/null || { echo "claude CLI not on PATH"; exit 1; }
[ -d "$REPO/.omniweave" ] || { echo "no .omniweave index at $REPO"; exit 1; }
cleanup(){ pkill -9 -f "serve --mcp --path $TGT" 2>/dev/null; }
trap cleanup EXIT
mkdir -p "$OUT"
( cd "$ENGINE" && npm run build >/dev/null 2>&1 ) && echo "built"

# Throwaway copy + fresh index (the agent works here; a read-only question won't
# edit, but isolate anyway). Excludes the source repo's index/build/vcs.
rm -rf "$TGT"
rsync -a --exclude node_modules --exclude .git --exclude dist --exclude .omniweave "$REPO/" "$TGT/"
node "$BIN" init "$TGT" >/dev/null 2>&1 && echo "indexed copy ($(node "$BIN" status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).fileCount+" files")}catch{console.log("?")}})' 2>/dev/null || echo '?'))"

echo "###### repo=$REPO  runs/arm=$RUNS"
echo "###### Q=$Q"; echo
echo '{"mcpServers":{}}' > "$OUT/mcp-empty.json"
printf '{"mcpServers":{"omniweave":{"command":"env","args":["OMNIWEAVE_WASM_RELAUNCHED=1","node","%s","serve","--mcp","--path","%s"]}}}' "$BIN" "$TGT" > "$OUT/mcp-cg.json"
TOTAL_RUNS=0
INVALID_RUNS=0

prewarm(){
  pkill -9 -f "serve --mcp --path $TGT" 2>/dev/null
  OMNIWEAVE_DAEMON_IDLE_TIMEOUT_MS=1800000 node "$BIN" serve --mcp --path "$TGT" </dev/null >/dev/null 2>&1 &
  node -e 'const fs=require("fs");let n=0;const t=setInterval(()=>{if(fs.existsSync(process.argv[1]+"/.omniweave/daemon.sock")){clearInterval(t);process.exit(0)}if(n++>150){clearInterval(t);process.exit(1)}},100)' "$TGT" >/dev/null 2>&1
}

run(){ # label, cfg, prewarm(0/1)
  local label="$1" cfg="$2" pw="$3"
  for i in $(seq 1 "$RUNS"); do
    [ "$pw" = "1" ] && prewarm
    ( cd "$TGT" && claude -p "$Q" --output-format stream-json --verbose \
        --permission-mode bypassPermissions --model "${MODEL:-sonnet}" --effort "${EFFORT:-high}" --max-budget-usd 4 \
        --strict-mcp-config --mcp-config "$cfg" </dev/null > "$OUT/$label-$i.jsonl" 2>"$OUT/$label-$i.err" )
    local rc=$?
    echo "[$label] run $i:"
    TOTAL_RUNS=$((TOTAL_RUNS+1))
    if ! analyze "$OUT/$label-$i.jsonl" "$OUT/$label-$i.err" "$rc"; then
      INVALID_RUNS=$((INVALID_RUNS+1))
    fi
  done
  echo
}

echo "== WITH omniweave (premise: explore/node used -> Read ~0) =="; run with "$OUT/mcp-cg.json" 1
echo "== WITHOUT (Read/Grep only — the contrast) =="; run without "$OUT/mcp-empty.json" 0
if [ "$INVALID_RUNS" -gt 0 ]; then
  echo "###### INVALID: $INVALID_RUNS/$TOTAL_RUNS claude runs failed; tool-call A/B is not valid. Logs: $OUT"
  exit 1
fi
echo "###### DONE. In the WITH arm: are explore/node>0 and Read~0? Any Read of an INDEXED source file = sufficiency gap. Logs: $OUT"
