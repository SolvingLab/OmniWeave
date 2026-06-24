#!/usr/bin/env bash
# Publication-grade agent A/B benchmark: OmniWeave vs upstream codegraph vs
# grep/read, driven by a real LLM (whatever ANTHROPIC_* point at — MiMo here),
# over a manifest of ground-truth-locked questions on REAL indexed repos.
#
# Two modes per differentiation question:
#   natural — shell allowed: measures whether the agent ADOPTS the MCP tool.
#   forced  — force-mcp-hook denies shell/source-read: measures whether the MCP,
#             once it is the only option, can ANSWER (tool sufficiency). This is
#             where a structural edge one tool has and another lacks becomes a
#             measurable answer/effort delta instead of a graph statistic.
#
# Fail-closed: any claude failure / empty jsonl / missing result marks the run
# INVALID; INVALID runs are written with valid=false and never scored as wins.
#
# Env: DATASETS_DIR (real clones), ANTHROPIC_BASE_URL/_AUTH_TOKEN, models.
# Keys are read from the environment only — never written to disk or echoed.
set -uo pipefail

ENGINE="$(cd "$(dirname "$0")/../../.." && pwd)"
OWBIN="$ENGINE/dist/bin/omniweave.js"
CGBIN="${CGBIN:-$ENGINE/research/2026-06-23-codegraph-ecosystem/repos/codegraph/dist/bin/codegraph.js}"
DATASETS_DIR="${DATASETS_DIR:?set DATASETS_DIR to the real-clone dir}"
MANIFEST="${1:-$ENGINE/eval-results/omniweave-benchmark/questions/benchmark-questions.json}"
OUT="${OUT:-$ENGINE/scripts/agent-eval/.bench-out}"
HOOK="$ENGINE/eval-results/omniweave-benchmark/harness/force-mcp-hook.sh"
PRO="${PRO:-mimo-v2.5-pro}"; SMALL="${SMALL:-mimo-v2.5}"
mkdir -p "$OUT"; : > "$OUT/results.jsonl"
command -v claude >/dev/null || { echo "claude CLI missing"; exit 1; }
command -v jq >/dev/null || { echo "jq missing"; exit 1; }

target_path(){ case "$1" in
  polyglot) echo "$ENGINE/__tests__/fixtures/polyglot-subprocess";;
  capstone) echo "$ENGINE/__tests__/fixtures/capstone";;
  *) echo "$DATASETS_DIR/$1";; esac; }

# Forced-mode settings file wiring the deny hook on PreToolUse.
printf '{"hooks":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"bash %s"}]}]}}' "$HOOK" > "$OUT/forced-settings.json"

mcp_cfg(){ # $1=arm $2=target-path -> prints config path
  local arm="$1" tgt="$2" f="$OUT/mcp-$1.json"
  case "$arm" in
    omniweave) printf '{"mcpServers":{"omniweave":{"command":"env","args":["OMNIWEAVE_WASM_RELAUNCHED=1","node","%s","serve","--mcp","--path","%s"]}}}' "$OWBIN" "$tgt" > "$f";;
    codegraph) printf '{"mcpServers":{"codegraph":{"command":"env","args":["CODEGRAPH_WASM_RELAUNCHED=1","node","%s","serve","--mcp","--path","%s"]}}}' "$CGBIN" "$tgt" > "$f";;
    grep) printf '{"mcpServers":{}}' > "$f";;
  esac; echo "$f"; }

prewarm(){ # $1=arm $2=tgt
  pkill -9 -f "serve --mcp --path $2" 2>/dev/null; sleep 1
  case "$1" in
    omniweave) OMNIWEAVE_DAEMON_IDLE_TIMEOUT_MS=3600000 OMNIWEAVE_WASM_RELAUNCHED=1 node "$OWBIN" serve --mcp --path "$2" </dev/null >/dev/null 2>&1 & ;;
    codegraph) CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS=3600000 CODEGRAPH_WASM_RELAUNCHED=1 node "$CGBIN" serve --mcp --path "$2" </dev/null >/dev/null 2>&1 & ;;
  esac; sleep 3; }

parse(){ node --no-warnings -e '
  const fs=require("fs"); const [f,ex]=[process.argv[1],Number(process.argv[2]||0)];
  let reasons=[],read=0,grep=0,bash=0,mcp=0,turns=0,ans="",hadResult=false;
  let txt=""; try{txt=fs.readFileSync(f,"utf8")}catch{reasons.push("no_jsonl")}
  if(!txt.trim())reasons.push("empty_jsonl"); if(ex!==0)reasons.push("exit="+ex);
  for(const ln of txt.split("\n")){ if(!ln.trim())continue; let o; try{o=JSON.parse(ln)}catch{continue}
    if(o.type==="assistant"&&o.message&&Array.isArray(o.message.content)){turns++;
      for(const b of o.message.content){ if(b.type==="text"&&b.text.trim())ans=b.text.trim();
        if(b.type==="tool_use"){const n=b.name||"";
          if(n==="Read")read++;else if(n==="Grep")grep++;else if(n==="Bash")bash++;
          else if(/mcp__/.test(n))mcp++;}}}
    if(o.type==="result"){hadResult=true; if(o.is_error)reasons.push("result_error")}}
  if(!hadResult)reasons.push("no_result");
  process.stdout.write(JSON.stringify({valid:reasons.length===0,reasons,read,grep,bash,mcp,turns,ans:ans.slice(0,300)}));
' "$1" "$2"; }

run_cell(){ # $1=qid $2=target $3=arm $4=mode $5=model $6=run
  local qid="$1" tgt="$2" arm="$3" mode="$4" model="$5" run="$6"
  local tp; tp="$(target_path "$tgt")"
  local cfg; cfg="$(mcp_cfg "$arm" "$tp")"
  local q; q="$(jq -r --arg id "$qid" '.[]|select(.id==$id)|.question' "$MANIFEST")"
  local lbl="$qid-$arm-$mode-$model-$run"
  local extra=""; [ "$mode" = forced ] && extra="--settings $OUT/forced-settings.json"
  [ "$arm" != grep ] && prewarm "$arm" "$tp"
  ( cd "$tp" && timeout 240 claude -p "$q" --output-format stream-json --verbose \
      --permission-mode bypassPermissions --model "$model" --max-budget-usd 3 \
      --strict-mcp-config --mcp-config "$cfg" $extra </dev/null > "$OUT/$lbl.jsonl" 2>"$OUT/$lbl.err" )
  local ex=$? r; r="$(parse "$OUT/$lbl.jsonl" "$ex")"
  echo "{\"id\":\"$qid\",\"arm\":\"$arm\",\"mode\":\"$mode\",\"model\":\"$model\",\"run\":$run,$(echo "$r"|sed 's/^{//')" >> "$OUT/results.jsonl"
  echo "[$lbl] $r"
}

# ---- the matrix ----
for qid in $(jq -r '.[].id' "$MANIFEST"); do
  typ="$(jq -r --arg id "$qid" '.[]|select(.id==$id)|.type' "$MANIFEST")"
  tgt="$(jq -r --arg id "$qid" '.[]|select(.id==$id)|.target' "$MANIFEST")"
  echo "########## $qid ($typ, target=$tgt) ##########"
  if [ "$typ" = differentiation ]; then
    for m in 1 2 3; do run_cell "$qid" "$tgt" omniweave forced "$PRO" "$m"; run_cell "$qid" "$tgt" codegraph forced "$PRO" "$m"; done
    for m in 1 2;   do run_cell "$qid" "$tgt" omniweave forced "$SMALL" "$m"; run_cell "$qid" "$tgt" codegraph forced "$SMALL" "$m"; done
    for m in 1 2;   do run_cell "$qid" "$tgt" omniweave natural "$PRO" "$m"; run_cell "$qid" "$tgt" codegraph natural "$PRO" "$m"; run_cell "$qid" "$tgt" grep natural "$PRO" "$m"; done
  else
    for m in 1 2 3; do run_cell "$qid" "$tgt" omniweave natural "$PRO" "$m"; run_cell "$qid" "$tgt" grep natural "$PRO" "$m"; done
  fi
done
pkill -9 -f "serve --mcp --path" 2>/dev/null
INV=$(grep -c '"valid":false' "$OUT/results.jsonl" || true); TOT=$(wc -l < "$OUT/results.jsonl")
echo "==== DONE: $TOT runs, $INV invalid. results: $OUT/results.jsonl ===="
