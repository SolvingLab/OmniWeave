#!/usr/bin/env bash
# PreToolUse hook (A/B experiment): remove the shell/file escape hatches so the
# agent MUST answer through the attached structural-graph MCP. Denies Bash,
# Grep, Glob, and Read-of-source; non-source Reads (config/.env/markdown) pass.
#
# This isolates TOOL SUFFICIENCY from TOOL ADOPTION: a natural-mode arm shows
# whether the agent *picks* the MCP; this forced-mode arm shows whether the MCP,
# once it is the only option, can actually answer — which is where a structural
# differentiator (cross-boundary/dispatch edges one tool has and another lacks)
# becomes a measurable answer/effort delta instead of a graph statistic.
#
# Wire via:  claude ... --settings <settings-with-this-hook-on-PreToolUse>
set -uo pipefail
input="$(cat)"
tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)"
fp="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"

deny() {
  jq -n --arg m "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$m}}'
  exit 0
}

STEER="Shell and source-file reading are disabled in this session. Answer using the attached code-graph MCP tools (explore / node / search / callers / impact) — they already index this repo with line numbers. If a symbol was not in a prior result, call explore again with its exact name."

case "$tool" in
  Bash|Grep|Glob)
    deny "$STEER" ;;
  Read)
    case "$fp" in
      *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.py|*.go|*.rs|*.java|*.rb|*.php|*.swift|*.kt|*.kts|*.c|*.cc|*.cpp|*.h|*.hpp|*.cs|*.lua|*.vue|*.svelte|*.R|*.r|*.smk|*.nf|*.scala|*.pl)
        deny "$STEER" ;;
    esac
    ;;
esac
exit 0
