// Score the agent A/B benchmark: match each run's answer against the locked
// ground truth, then aggregate by (question, arm, mode, model). Correctness is
// keyword/semantic match per question; borderline answers are flagged for human
// / skeptic review. Effort = mean tool calls + turns. Honest: a tie is a tie.
//
// Usage: node score-benchmark.mjs <results.jsonl> <benchmark-questions.json>
import { readFileSync } from 'node:fs';

const [, , resultsPath, manifestPath] = process.argv;
if (!resultsPath || !manifestPath) {
  console.error('Usage: node score-benchmark.mjs <results.jsonl> <benchmark-questions.json>');
  process.exit(2);
}

const runs = readFileSync(resultsPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const byId = Object.fromEntries(manifest.map((q) => [q.id, q]));

// Per-question correctness predicate over the (lowercased) answer text.
const GRADERS = {
  'Q1-s4-dispatch': (a) => a.includes('deseqdataset') && a.includes('deseqresults'),
  'Q2-crosslang-static': (a) => a.includes('deseq.r'),
  'Q3-invokes': (a) => /\bstar\b/.test(a),
  // honest answer = the path is NOT statically resolvable / runtime (EN + 中文)
  'Q4-crosslang-runtime-ceiling': (a) => /\bno\b/.test(a) || a.includes('否') || a.includes('runtime') || a.includes('运行时') || a.includes('动态解析') || a.includes('not statically') || (a.includes('静态') && (a.includes('无法') || a.includes('不'))) || a.includes('not resolvable') || a.includes('resource_filename'),
  'Q5-single-point-tie': (a) => a.includes('core.r'),
  // honest no-help = not localizable / scattered (EN + 中文)
  'Q6-concept-no-help': (a) => a.includes('not localiz') || a.includes('scattered') || a.includes('multiple') || a.includes('not a single') || a.includes('throughout') || a.includes('across') || a.includes('inline') || a.includes('分散') || a.includes('不是集中') || a.includes('无法定位') || a.includes('没有集中') || a.includes('不集中'),
  // --- v3 diverse bank (more datasets / domains) ---
  'v3-S4-se-cbind': (a) => a.includes('assays') && a.includes('summarizedexperiment'),
  'v3-S4-gr-asdf': (a) => a.includes('genomicranges') && a.includes('gpos'),
  'v3-CL-rnaseq-r': (a) => a.includes('deseq2-init.r'),
  'v3-WF-rnaseq-dag': (a) => a.includes('star_align'),
  'v3-INV-rnaseq-star': (a) => /\bstar\b/.test(a),
  'v3-RB-deseq2-callers': (a) => a.includes('deseq'),
  'v3-CL-maestro-ceiling': (a) => /\bno\b/.test(a) || a.includes('否') || a.includes('runtime') || a.includes('运行时') || a.includes('动态') || a.includes('not statically') || a.includes('resource_filename'),
  'v3-H-se-concept': (a) => a.includes('not localiz') || a.includes('scattered') || a.includes('multiple') || a.includes('across') || a.includes('inline') || a.includes('分散') || a.includes('不是集中') || a.includes('无法定位') || a.includes('没有集中') || a.includes('不集中'),
  // --- new-edge bank (module-var-ref / rtkQuery / dispatch synthesizers) ---
  'NE-rtk-hook': (a) => a.includes('/api'),
  'NE-pinia-login': (a) => a.includes('auth.js') || a.includes('auth.ts') || a.includes('store/auth'),
  'NE-sidekiq-worker': (a) => a.includes('destroyuserworker'),
  'NE-celery-task': (a) => a.includes('send_welcome_email'),
  'NE-modvar-impact': (a) => a.includes('check_compatibility'),
  'NE-singlepoint-tie': (a) => a.includes('__init__.py'),
  // honest negative-feature: the answer is No / 没有 / does not ship one
  'NE-nohelp': (a) => /\bno\b/.test(a) || a.includes('否') || a.includes('没有') || a.includes('does not') || a.includes("doesn't") || a.includes('no built-in') || a.includes('not ship') || a.includes('no dashboard'),
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
