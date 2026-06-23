#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$ROOT/repos"
OUT="$ROOT/metadata/keyword-scan.tsv"

printf 'repo\tkeyword\tcount\n' > "$OUT"

keywords=(
  'tree-sitter'
  'mcp'
  'sqlite'
  'tantivy'
  'vector'
  'embedding'
  'lsp'
  'language server'
  'call graph'
  'caller'
  'callees'
  'subprocess'
  'child_process'
  'exec.Command'
  'Snakemake'
  'Nextflow'
  'Snakefile'
  'setMethod'
  'SCIP'
  'provenance'
  'confidence'
  'watcher'
  'PageRank'
  'repo map'
)

for repo in "$REPO_DIR"/*; do
  [[ -d "$repo/.git" ]] || continue
  id="$(basename "$repo")"
  for keyword in "${keywords[@]}"; do
    count="$( { rg -i --fixed-strings --glob '!.git' --glob '!node_modules' --glob '!target' --glob '!dist' --glob '!build' --glob '!vendor' --count-matches "$keyword" "$repo" 2>/dev/null || true; } | awk -F: '{sum += $NF} END {print sum+0}')"
    printf '%s\t%s\t%s\n' "$id" "$keyword" "$count" >> "$OUT"
  done
done

echo "$OUT"
