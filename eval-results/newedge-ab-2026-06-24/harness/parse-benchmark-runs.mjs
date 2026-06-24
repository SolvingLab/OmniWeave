#!/usr/bin/env node
// Rebuild benchmark runs.jsonl from Claude stream-json transcripts.
//
// Usage:
//   node parse-benchmark-runs.mjs <raw-dir> [summary-results.jsonl] > runs.jsonl
//
// The optional summary file contributes process-level validity reasons (for
// example timeout exit codes) that are not present inside the stream transcript.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [, , rawDir, summaryPath] = process.argv;
if (!rawDir) {
  console.error('Usage: node parse-benchmark-runs.mjs <raw-dir> [summary-results.jsonl]');
  process.exit(2);
}

const ARMS = new Set(['omniweave', 'codegraph', 'grep']);
const MODES = new Set(['forced', 'natural']);

function parseLabel(file) {
  const stem = basename(file, '.jsonl');
  const parts = stem.split('-');
  const run = Number(parts.at(-1));
  if (!Number.isInteger(run) || run < 1) return null;
  for (let i = 1; i < parts.length - 2; i++) {
    if (!ARMS.has(parts[i]) || !MODES.has(parts[i + 1])) continue;
    const id = parts.slice(0, i).join('-');
    const arm = parts[i];
    const mode = parts[i + 1];
    const model = parts.slice(i + 2, -1).join('-');
    if (id && model) return { id, arm, mode, model, run };
  }
  return null;
}

function summaryKey(run) {
  return `${run.id}|${run.arm}|${run.mode}|${run.model}|${run.run}`;
}

function readSummary(path) {
  const rows = new Map();
  if (!path) return rows;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    rows.set(summaryKey(row), row);
  }
  return rows;
}

function parseTranscript(path) {
  let reasons = [];
  let read = 0;
  let grep = 0;
  let bash = 0;
  let mcp = 0;
  let turns = 0;
  let ans = '';
  let hadResult = false;
  let text = '';

  try {
    text = readFileSync(path, 'utf8');
  } catch {
    reasons.push('no_jsonl');
  }
  if (!text.trim()) reasons.push('empty_jsonl');

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'assistant' && event.message && Array.isArray(event.message.content)) {
      turns++;
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text.trim()) ans = block.text.trim();
        if (block.type !== 'tool_use') continue;
        const name = block.name || '';
        if (name === 'Read') read++;
        else if (name === 'Grep') grep++;
        else if (name === 'Bash') bash++;
        else if (/mcp__/.test(name)) mcp++;
      }
    }
    if (event.type === 'result') {
      hadResult = true;
      if (event.is_error) reasons.push('result_error');
    }
  }
  if (!hadResult) reasons.push('no_result');

  return { reasons, read, grep, bash, mcp, turns, ans };
}

const summary = readSummary(summaryPath);
let exitCode = 0;
const files = readdirSync(rawDir).filter((file) => file.endsWith('.jsonl') && file !== 'results.jsonl').sort();
for (const file of files) {
  const label = parseLabel(file);
  if (!label) {
    console.error(`Cannot parse benchmark label: ${file}`);
    exitCode = 1;
    continue;
  }
  const parsed = parseTranscript(join(rawDir, file));
  const prior = summary.get(summaryKey(label));
  const reasons = prior?.reasons ?? parsed.reasons;
  const valid = prior?.valid ?? reasons.length === 0;
  process.stdout.write(
    JSON.stringify({
      ...label,
      valid,
      reasons,
      read: parsed.read,
      grep: parsed.grep,
      bash: parsed.bash,
      mcp: parsed.mcp,
      turns: parsed.turns,
      ans: parsed.ans,
    }) + '\n'
  );
}

process.exit(exitCode);
