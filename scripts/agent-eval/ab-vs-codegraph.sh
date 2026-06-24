#!/usr/bin/env bash
# Three-arm agent A/B: same question, same model, three retrieval surfaces —
# OmniWeave MCP vs upstream codegraph MCP vs no MCP (grep/read only). Measures
# tool-call effort (mcp calls / Read / Grep / turns), NOT correctness claims.
#
# Fail-closed: a non-zero claude exit, empty JSONL, or missing result marks the
# run INVALID and the whole script exits non-zero — never a fake "0 tools" win.
#
# Usage: ab-vs-codegraph.sh <repo-indexed-by-both> <codegraph-bin> "<question>" [runs]
# Model: drives `claude` against whatever ANTHROPIC_BASE_URL/_AUTH_TOKEN/_MODEL
# are exported (point them at MiMo for a real-LLM run). Keys never touch disk.
set -uo pipefail

REPO="${1:?repo}"; CGBIN="${2:?codegraph bin}"; Q="${3:?question}"; RUNS="${4:-2}"
ENGINE="$(cd "$(dirname "$0")/../.." && pwd)"
OWBIN="$ENGINE/dist/bin/omniweave.js"
MODEL="${MODEL:-mimo-v2.5-pro}"
command -v claude >/dev/null || { echo "claude CLI not on PATH"; exit 1; }
[ -f "$CGBIN" ] || { echo "codegraph bin missing: $CGBIN"; exit 1; }

OUT="$(mktemp -d /tmp/ab-vs-cg-XXXX)"
TGT="$OUT/target"
rsync -a --exclude node_modules --exclude .git --exclude dist --exclude .omniweave --exclude .codegraph "$REPO/" "$TGT/"
echo "target: $TGT  | out: $OUT  | model: $MODEL  | runs/arm: $RUNS"

# Index the target with both tools.
OMNIWEAVE_WASM_RELAUNCHED=1 node "$OWBIN" init "$TGT" </dev/null >/dev/null 2>&1
node "$CGBIN" init "$TGT" </dev/null >/dev/null 2>&1

# MCP configs.
printf '{"mcpServers":{}}' > "$OUT/mcp-none.json"
printf '{"mcpServers":{"omniweave":{"command":"env","args":["OMNIWEAVE_WASM_RELAUNCHED=1","node","%s","serve","--mcp","--path","%s"]}}}' "$OWBIN" "$TGT" > "$OUT/mcp-ow.json"
printf '{"mcpServers":{"codegraph":{"command":"env","args":["CODEGRAPH_WASM_RELAUNCHED=1","node","%s","serve","--mcp","--path","%s"]}}}' "$CGBIN" "$TGT" > "$OUT/mcp-cg.json"

cleanup(){ pkill -9 -f "serve --mcp --path $TGT" 2>/dev/null; }
trap cleanup EXIT

INVALID=0; TOTAL=0
parse(){ # $1=jsonl $2=exit
  node --no-warnings -e '
    const fs=require("fs"); const [f,ex]=[process.argv[1],Number(process.argv[2]||0)];
    let reasons=[]; let read=0,grep=0,bash=0,owc=0,cgc=0,turns=0,ans="",hadResult=false;
    let txt=""; try{txt=fs.readFileSync(f,"utf8")}catch(e){reasons.push("no_jsonl")}
    if(!txt.trim())reasons.push("empty_jsonl");
    if(ex!==0)reasons.push("claude_exit="+ex);
    for(const line of txt.split("\n")){ if(!line.trim())continue; let o; try{o=JSON.parse(line)}catch{continue}
      if(o.type==="assistant"&&o.message&&Array.isArray(o.message.content)){ turns++;
        for(const b of o.message.content){
          if(b.type==="text")ans=b.text;
          if(b.type==="tool_use"){ const n=b.name||"";
            if(n==="Read")read++; else if(n==="Grep")grep++; else if(n==="Bash")bash++;
            else if(/mcp__omniweave__/.test(n))owc++; else if(/mcp__codegraph__/.test(n))cgc++; }
        }
      }
      if(o.type==="result"){hadResult=true; if(o.is_error)reasons.push("result_error")}
    }
    if(!hadResult)reasons.push("no_result");
    const valid=reasons.length===0;
    console.log(JSON.stringify({valid,reasons,read,grep,bash,owc,cgc,turns,ans:ans.slice(0,400)}));
  ' "$1" "$2"
}

run(){ # $1=label $2=cfg
  local label="$1" cfg="$2"
  cleanup; sleep 1
  # pre-warm the relevant daemon so claude attaches before its first turn
  if grep -q omniweave "$cfg"; then OMNIWEAVE_DAEMON_IDLE_TIMEOUT_MS=1800000 OMNIWEAVE_WASM_RELAUNCHED=1 node "$OWBIN" serve --mcp --path "$TGT" </dev/null >/dev/null 2>&1 & fi
  if grep -q codegraph "$cfg"; then CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS=1800000 CODEGRAPH_WASM_RELAUNCHED=1 node "$CGBIN" serve --mcp --path "$TGT" </dev/null >/dev/null 2>&1 & fi
  sleep 3
  for i in $(seq 1 "$RUNS"); do
    TOTAL=$((TOTAL+1))
    ( cd "$TGT" && timeout 240 claude -p "$Q" --output-format stream-json --verbose \
        --permission-mode bypassPermissions --model "$MODEL" --max-budget-usd 3 \
        --strict-mcp-config --mcp-config "$cfg" </dev/null > "$OUT/$label-$i.jsonl" 2>"$OUT/$label-$i.err" )
    local ex=$?
    local r; r=$(parse "$OUT/$label-$i.jsonl" "$ex")
    echo "[$label #$i] $r"
    echo "$r" | grep -q '"valid":false' && INVALID=$((INVALID+1))
  done
}

echo "== ARM: omniweave =="; run omniweave "$OUT/mcp-ow.json"
echo "== ARM: codegraph =="; run codegraph "$OUT/mcp-cg.json"
echo "== ARM: grep-only =="; run none "$OUT/mcp-none.json"

echo "---- INVALID $INVALID / $TOTAL ----"
[ "$INVALID" -gt 0 ] && { echo "###### INVALID: $INVALID/$TOTAL runs failed; A/B not valid. Logs: $OUT"; exit 2; }
echo "OK: all $TOTAL runs valid. Logs: $OUT"
