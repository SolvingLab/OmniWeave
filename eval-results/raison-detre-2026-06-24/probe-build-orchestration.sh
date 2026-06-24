#!/usr/bin/env bash
# Pilot probe: how dense are build-orchestration -> local-script edges in real repos?
#
# Tests the only un-PARK'd candidate for a WIDER general moat (§3 of README.md):
# would Makefile / package.json-scripts / Dockerfile / CI-YAML -> local-script edges
# form traversable multi-hop chains an agent needs a structural graph for, or are the
# matches mostly shallow packaging/test script references that still need grep/read?
#
# This is a PILOT (small N), not the publication benchmark. It is committed so the §3
# claim is reproducible. A formal NO-GO would need the full artifact standard
# (corpus manifest + GT-locked agent A/B) — see README.md §3.
#
# Usage: bash probe-build-orchestration.sh <repos-dir>   (default: the research corpus)
# No `set -e`: this is a best-effort scan over many heterogeneous repos; a grep/find
# that finds nothing in one repo must not abort the whole sweep.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)/research/2026-06-23-codegraph-ecosystem/repos}"
echo "# Build-orchestration edge-density pilot"
echo "# repos dir: $ROOT"
echo "# date: $(date -u +%Y-%m-%dT%H:%MZ)"
echo

scan_repo() {
  local repo="$1" name; name="$(basename "$repo")"
  [ -d "$repo" ] || return 0
  local ci docker mk pj
  ci=$(find "$repo/.github/workflows" -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null | wc -l | tr -d ' ')
  docker=$(find "$repo" -iname 'Dockerfile*' -not -path '*/node_modules/*' 2>/dev/null | wc -l | tr -d ' ')
  mk=$(find "$repo" -name 'Makefile' -not -path '*/node_modules/*' 2>/dev/null | wc -l | tr -d ' ')
  pj=$(find "$repo" -name 'package.json' -not -path '*/node_modules/*' 2>/dev/null | wc -l | tr -d ' ')

  # Distinct LOCAL-script references the orchestration files make (the edges an
  # extractor would create): a path to a .sh/.py/.js/.rb script that lives in the repo,
  # invoked from CI/Docker/Makefile. Inline tool commands (pip/pytest/tsc/...) are NOT edges.
  local edges
  edges=$( { grep -rhoE '(\./|[a-zA-Z0-9_./-]*/)?(scripts?|bin|tools?|ci)/[a-zA-Z0-9_./-]+\.(sh|py|js|rb)' \
              "$repo/.github" "$repo"/Dockerfile* "$repo"/docker 2>/dev/null || true; } \
            | sort -u | grep -vE 'node_modules' || true )
  local n_edges; n_edges=$(printf '%s\n' "$edges" | grep -c . || true)

  printf '## %s\n' "$name"
  printf '  orchestration files: CI=%s Dockerfile=%s Makefile=%s package.json=%s\n' "$ci" "$docker" "$mk" "$pj"
  printf '  distinct local-script edges from orchestration: %s\n' "$n_edges"
  if [ -n "$edges" ]; then printf '%s\n' "$edges" | sed 's/^/    - /'; fi
  echo
}

for d in "$ROOT"/*/; do scan_repo "${d%/}"; done

echo "# Interpretation: this pilot is a coarse edge-density scan, not a benchmark."
echo "# Sparse repos and dense plugin-script repos both appear; raw regex counts alone"
echo "# do not prove either a traversal moat or a NO-GO. A real decision needs"
echo "# semantic classification plus GT-locked agent A/B."
