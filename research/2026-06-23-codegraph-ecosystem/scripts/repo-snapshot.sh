#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$ROOT/repos"
OUT="$ROOT/metadata/repo-snapshot.tsv"

printf 'id\tpath\tcommit\tfiles\tbytes\tprimary_markers\n' > "$OUT"

for repo in "$REPO_DIR"/*; do
  [[ -d "$repo/.git" ]] || continue
  id="$(basename "$repo")"
  commit="$(git -C "$repo" rev-parse --short HEAD 2>/dev/null || printf unknown)"
  files="$(git -C "$repo" ls-files | wc -l | tr -d ' ')"
  bytes="$(du -sk "$repo" | awk '{print $1}')"
  markers="$(
    {
      [[ -f "$repo/package.json" ]] && printf 'package.json,'
      [[ -f "$repo/Cargo.toml" ]] && printf 'Cargo.toml,'
      [[ -f "$repo/pyproject.toml" ]] && printf 'pyproject.toml,'
      [[ -f "$repo/go.mod" ]] && printf 'go.mod,'
      [[ -f "$repo/README.md" ]] && printf 'README.md,'
    } | sed 's/,$//'
  )"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$repo" "$commit" "$files" "$bytes" "$markers" >> "$OUT"
done

echo "$OUT"
