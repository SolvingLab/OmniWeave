#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$ROOT/repos"
LIST="$ROOT/metadata/repos.tsv"

mkdir -p "$REPO_DIR"

tail -n +2 "$LIST" | while IFS=$'\t' read -r id repo url evidence; do
  target="$REPO_DIR/$id"
  if [[ "$evidence" == "source-sampled" && "${CLONE_SAMPLED:-0}" != "1" ]]; then
    echo "==> skipping sampled target $id (set CLONE_SAMPLED=1 to clone)"
    continue
  fi
  if [[ -d "$target/.git" ]]; then
    echo "==> $id already cloned"
    continue
  fi
  echo "==> cloning $id ($repo)"
  git clone --depth=1 --filter=blob:none "$url" "$target"
done
