#!/usr/bin/env node
// Aggregate Step A raw runs (results.jsonl) into the decision table.
//
// The decision the artifact exists to make (war plan §1 Step A):
//   On CONTENT questions (string literals the structural graph can't hold),
//   does the structural-only OmniWeave+Bash arm REGRESS on correctness vs the
//   grep baseline, or merely tie at ~+1 tool call?
//     correctness regresses  -> content index is an OUTCOME win  (10-20% route)
//     correctness ties, +tools -> content index is an ECONOMY win (60-70% route)
// We never claim a correctness win for OmniWeave; the headline is tools at equal
// correctness. INVALID runs (fail-closed) are excluded and counted separately.
//
// Usage: node score-step-a.mjs <results.jsonl> [questions.json]
import * as fs from 'node:fs';

const resultsPath = process.argv[2];
const questionsPath = process.argv[3];
if (!resultsPath || !fs.existsSync(resultsPath)) {
  console.error(`results jsonl not found: ${resultsPath}`);
  process.exit(1);
}
const axisOf = {};
if (questionsPath && fs.existsSync(questionsPath)) {
  for (const q of JSON.parse(fs.readFileSync(questionsPath, 'utf8'))) axisOf[q.id] = q.axis;
}

const rows = fs
  .readFileSync(resultsPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const ARMS = ['omniweave', 'codegraph', 'grep'];
const byQA = new Map(); // `${qid}|${arm}` -> [rows]
const qids = [];
for (const r of rows) {
  if (!qids.includes(r.qid)) qids.push(r.qid);
  const k = `${r.qid}|${r.arm}`;
  if (!byQA.has(k)) byQA.set(k, []);
  byQA.get(k).push(r);
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');

function cell(qid, arm) {
  const all = byQA.get(`${qid}|${arm}`) ?? [];
  const valid = all.filter((r) => r.valid);
  const invalid = all.length - valid.length;
  if (!valid.length) return { txt: invalid ? `INVALID(${invalid})` : '–', tools: NaN, correctRate: NaN, n: 0, invalid };
  const correctRate = mean(valid.map((r) => (r.correct ? 1 : 0)));
  const tools = mean(valid.map((r) => r.tools));
  const turns = mean(valid.map((r) => r.turns));
  return {
    txt: `${(correctRate * 100).toFixed(0)}%✓ ${fmt(tools)}t ${fmt(turns)}τ${invalid ? ` !${invalid}` : ''}`,
    tools,
    turns,
    correctRate,
    n: valid.length,
    invalid,
  };
}

// ── Per-question table ──────────────────────────────────────────────────────
console.log('## Step A results — per question (correctness✓ / mean tool-calls t / mean turns τ)\n');
console.log('| Question | axis | omniweave (struct+Bash) | codegraph (struct+Bash) | grep (Bash+Read) |');
console.log('|---|---|---|---|---|');
for (const qid of qids) {
  const a = axisOf[qid] ?? '?';
  const c = ARMS.map((arm) => cell(qid, arm).txt);
  console.log(`| ${qid} | ${a} | ${c[0]} | ${c[1]} | ${c[2]} |`);
}

// ── Axis roll-up: the decision ──────────────────────────────────────────────
function rollup(axisFilter) {
  const out = {};
  for (const arm of ARMS) {
    const cells = qids
      .filter((q) => (axisFilter ? axisOf[q] === axisFilter : true))
      .map((q) => cell(q, arm))
      .filter((c) => c.n > 0);
    out[arm] = {
      correct: mean(cells.map((c) => c.correctRate)),
      tools: mean(cells.map((c) => c.tools)),
      turns: mean(cells.map((c) => c.turns)),
    };
  }
  return out;
}

console.log('\n## Axis roll-up (mean across questions in the axis)\n');
console.log('| axis | metric | omniweave | codegraph | grep |');
console.log('|---|---|---|---|---|');
for (const axis of ['structural', 'content', 'ceiling']) {
  const r = rollup(axis);
  if (![...qids].some((q) => axisOf[q] === axis)) continue;
  console.log(`| ${axis} | correctness | ${(r.omniweave.correct * 100).toFixed(0)}% | ${(r.codegraph.correct * 100).toFixed(0)}% | ${(r.grep.correct * 100).toFixed(0)}% |`);
  console.log(`| ${axis} | mean tools | ${fmt(r.omniweave.tools)} | ${fmt(r.codegraph.tools)} | ${fmt(r.grep.tools)} |`);
  console.log(`| ${axis} | mean turns | ${fmt(r.omniweave.turns)} | ${fmt(r.codegraph.turns)} | ${fmt(r.grep.turns)} |`);
}

// ── The verdict line ────────────────────────────────────────────────────────
const content = rollup('content');
const invalidTotal = rows.filter((r) => !r.valid).length;
console.log('\n## Decision signal (content axis)\n');
if (Number.isFinite(content.omniweave.correct) && Number.isFinite(content.grep.correct)) {
  const owC = content.omniweave.correct, grepC = content.grep.correct;
  const regress = owC + 1e-9 < grepC;
  console.log(`- content correctness: omniweave ${(owC * 100).toFixed(0)}% vs grep ${(grepC * 100).toFixed(0)}%`);
  console.log(`- content mean tools: omniweave ${fmt(content.omniweave.tools)} vs grep ${fmt(content.grep.tools)}`);
  console.log(
    regress
      ? `- VERDICT(directional): structural-only OmniWeave REGRESSES on content correctness -> content index has OUTCOME value (lean 10-20% general route). Verify with more repos before claiming.`
      : `- VERDICT(directional): content correctness TIES; difference is tool-calls only -> content index is an ECONOMY win (lean 60-70% best-in-niche+superset route). No correctness-win claim.`
  );
}
console.log(`\nINVALID runs (excluded, fail-closed): ${invalidTotal}/${rows.length}`);
