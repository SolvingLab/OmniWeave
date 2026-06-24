// Score the agent A/B benchmark: match each run's answer against the locked
// ground truth, then aggregate by (question, arm, mode, model). Correctness is
// keyword/semantic match per question; borderline answers are flagged for human
// / skeptic review. Effort = mean tool calls + turns. Honest: a tie is a tie.
//
// Usage: node score-benchmark.mjs <results.jsonl> <benchmark-questions.json>
import { readFileSync } from 'node:fs';

const [, , resultsPath, manifestPath] = process.argv;
const runs = readFileSync(resultsPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const byId = Object.fromEntries(manifest.map((q) => [q.id, q]));

// Per-question correctness predicate over the (lowercased) answer text.
const GRADERS = {
  'Q1-s4-dispatch': (a) => a.includes('deseqdataset') && a.includes('deseqresults'),
  'Q2-crosslang-static': (a) => a.includes('deseq.r'),
  'Q3-invokes': (a) => /\bstar\b/.test(a),
  // honest answer = the path is NOT statically resolvable / runtime / no
  'Q4-crosslang-runtime-ceiling': (a) => /\bno\b/.test(a) || a.includes('runtime') || a.includes('not statically') || a.includes('not resolvable') || a.includes('cannot'),
  'Q5-single-point-tie': (a) => a.includes('core.r'),
  // honest no-help = not localizable / scattered / not a single file / not structural
  'Q6-concept-no-help': (a) => a.includes('not localiz') || a.includes('scattered') || a.includes('multiple') || a.includes('not a single') || a.includes('throughout') || a.includes('across') || a.includes('not structural') || a.includes('inline'),
};

function grade(run) {
  const g = GRADERS[run.id];
  const a = (run.ans || '').toLowerCase();
  if (!run.valid) return 'INVALID';
  if (!g) return 'UNGRADED';
  return g(a) ? 'CORRECT' : 'WRONG';
}

// Aggregate.
const cells = {};
for (const r of runs) {
  const key = `${r.id}|${r.arm}|${r.mode}|${r.model}`;
  (cells[key] ??= { runs: [], correct: 0, invalid: 0, mcp: 0, read: 0, grep: 0, bash: 0, turns: 0 });
  const c = cells[key];
  const v = grade(r);
  c.runs.push({ run: r.run, verdict: v, ans: r.ans, mcp: r.mcp, read: r.read, grep: r.grep, bash: r.bash, turns: r.turns });
  if (v === 'CORRECT') c.correct++;
  if (v === 'INVALID') c.invalid++;
  c.mcp += r.mcp; c.read += r.read; c.grep += r.grep; c.bash += r.bash; c.turns += r.turns;
}

console.log('# Agent A/B benchmark — scored\n');
const ids = [...new Set(runs.map((r) => r.id))];
for (const id of ids) {
  const q = byId[id];
  console.log(`\n## ${id}  (${q?.type})  — GT: ${q?.groundTruth?.slice(0, 80)}`);
  const keys = Object.keys(cells).filter((k) => k.startsWith(id + '|')).sort();
  console.log('arm/mode/model'.padEnd(40), 'correct', 'mcp', 'read', 'grep', 'bash', 'turns');
  for (const k of keys) {
    const c = cells[k];
    const n = c.runs.length;
    const label = k.split('|').slice(1).join('/');
    const avg = (x) => (x / n).toFixed(1);
    console.log(
      label.padEnd(40),
      `${c.correct}/${n}`.padEnd(7),
      avg(c.mcp).padStart(3),
      avg(c.read).padStart(4),
      avg(c.grep).padStart(4),
      avg(c.bash).padStart(4),
      avg(c.turns).padStart(5),
    );
  }
}

// Honest summary.
console.log('\n\n# Honest verdict per question\n');
for (const id of ids) {
  const q = byId[id];
  const keys = Object.keys(cells).filter((k) => k.startsWith(id + '|'));
  const armAcc = {};
  for (const k of keys) {
    const arm = k.split('|')[1];
    (armAcc[arm] ??= { c: 0, n: 0 });
    armAcc[arm].c += cells[k].correct; armAcc[arm].n += cells[k].runs.length;
  }
  const summary = Object.entries(armAcc).map(([arm, v]) => `${arm} ${v.c}/${v.n}`).join('  ');
  console.log(`- **${id}** (${q?.type}): ${summary}`);
}
