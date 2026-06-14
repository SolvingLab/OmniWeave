#!/usr/bin/env bash
# Round 6 — master post-build runner. Serial (one claude -p at a time), so all
# three A/B suites run unattended on the NEW build without competing. Inherits
# the harness auth proxy — DO NOT clear it.
#
# PRECONDITION: dist rebuilt (callers fix) and pgrep -f 'claude -p' == 0 at launch.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "=========== MASTER AFTER-RUN — omniweave $(omniweave --version) ==========="

echo ">>> [1/3] Track 1 AFTER (callers fix, vscode, sonnet) <<<"
N="${N:-3}" MODEL=sonnet EFFORT=high bash "$HERE/run-track1-after.sh"

echo ">>> [2/3] Track 3 toggle (ToolSearch gating, DESeq2, sonnet) <<<"
N="${N:-3}" MODEL=sonnet EFFORT=high bash "$HERE/run-track3-toggle.sh"

echo ">>> [3/3] Track 2 haiku moat matrix (4 archetypes) <<<"
N="${N:-3}" bash "$HERE/run-track2-haiku.sh"

echo "=========== MASTER-AFTER-ALL-DONE ==========="
