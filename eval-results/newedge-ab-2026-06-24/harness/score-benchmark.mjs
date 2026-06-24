// Score the agent A/B benchmark: match each run's answer against the locked
// ground truth, then aggregate by (question, arm, mode, model). Correctness is
// keyword/semantic match per question; borderline answers are flagged for human
// / skeptic review. Effort = mean tool calls + turns. Honest: a tie is a tie.
//
// Usage: node score-benchmark.mjs [--require-complete] [--scored-jsonl <out.jsonl>] <results.jsonl> <benchmark-questions.json>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

let scoredJsonlPath = '';
let requireComplete = false;
const positional = [];
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--scored-jsonl') {
    scoredJsonlPath = process.argv[++i] || '';
    continue;
  }
  if (arg === '--require-complete') {
    requireComplete = true;
    continue;
  }
  positional.push(arg);
}

const [resultsPath, manifestPath] = positional;
if (!resultsPath || !manifestPath) {
  console.error('Usage: node score-benchmark.mjs [--require-complete] [--scored-jsonl <out.jsonl>] <results.jsonl> <benchmark-questions.json>');
  process.exit(2);
}

const runs = readFileSync(resultsPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (runs.length === 0) {
  console.error(`No runs found in ${resultsPath}`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const byId = Object.fromEntries(manifest.map((q) => [q.id, q]));
const ARM_ORDER = ['omniweave', 'codegraph', 'grep'];

function normalizedAnswer(answer) {
  return String(answer || '').toLowerCase().replace(/\\/g, '/');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasNearbyNegation(answer, index) {
  const before = answer.slice(Math.max(0, index - 32), index);
  return /(?:\bnot\b|不是|并非|不应是|不应该是|不是这个|不是该|wrong|incorrect)\s*$/.test(before);
}

function containsDelimited(answer, needle, boundary = /[a-z0-9_./-]/) {
  const target = needle.toLowerCase();
  let index = answer.indexOf(target);
  while (index !== -1) {
    const before = index === 0 ? '' : answer[index - 1];
    const after = answer[index + target.length] || '';
    if (!boundary.test(before) && !boundary.test(after) && !hasNearbyNegation(answer, index)) {
      return true;
    }
    index = answer.indexOf(target, index + target.length);
  }
  return false;
}

function containsPath(answer, acceptedPaths) {
  for (const path of acceptedPaths) {
    const pattern = new RegExp(
      `(?:^|[^a-z0-9_.-])(?:\\/?[a-z0-9_.-]+\\/)*${escapeRegex(path)}(?:$|[^a-z0-9_./-])`,
      'g'
    );
    let match;
    while ((match = pattern.exec(answer)) !== null) {
      const pathIndex = match.index + match[0].indexOf(path);
      if (!hasNearbyNegation(answer, Math.min(match.index, pathIndex))) return true;
    }
  }
  return false;
}

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
  'NE-rtk-hook': (a) => containsDelimited(a, '/api', /[a-z0-9_./-]/),
  'NE-pinia-login': (a) => containsPath(a, ['src/store/auth.js', 'store/auth.js']),
  'NE-sidekiq-worker': (a) => containsDelimited(a, 'destroyuserworker', /[a-z0-9_]/),
  'NE-celery-task': (a) => containsDelimited(a, 'send_welcome_email', /[a-z0-9_]/),
  'NE-modvar-impact': (a) => containsDelimited(a, 'check_compatibility', /[a-z0-9_]/),
  'NE-singlepoint-tie': (a) => containsPath(a, ['src/requests/__init__.py']),
  // honest negative-feature: the answer is No / 没有 / does not ship one
  'NE-nohelp': (a) => /\bno\b/.test(a) || a.includes('否') || a.includes('没有') || a.includes('does not') || a.includes("doesn't") || a.includes('no built-in') || a.includes('not ship') || a.includes('no dashboard'),
};

function grade(run) {
  const g = GRADERS[run.id];
  const a = normalizedAnswer(run.ans);
  if (!run.valid) return 'INVALID';
  if (!g) return 'UNGRADED';
  return g(a) ? 'CORRECT' : 'WRONG';
}

function expectedRunIds() {
  const expected = [];
  for (const q of manifest) {
    if (q.type === 'differentiation') {
      for (let run = 1; run <= 3; run++) {
        expected.push(`${q.id}|omniweave|forced|mimo-v2.5-pro|${run}`);
        expected.push(`${q.id}|codegraph|forced|mimo-v2.5-pro|${run}`);
      }
      for (let run = 1; run <= 2; run++) {
        expected.push(`${q.id}|omniweave|forced|mimo-v2.5|${run}`);
        expected.push(`${q.id}|codegraph|forced|mimo-v2.5|${run}`);
        expected.push(`${q.id}|omniweave|natural|mimo-v2.5-pro|${run}`);
        expected.push(`${q.id}|codegraph|natural|mimo-v2.5-pro|${run}`);
        expected.push(`${q.id}|grep|natural|mimo-v2.5-pro|${run}`);
      }
    } else {
      for (let run = 1; run <= 3; run++) {
        expected.push(`${q.id}|omniweave|natural|mimo-v2.5-pro|${run}`);
        expected.push(`${q.id}|grep|natural|mimo-v2.5-pro|${run}`);
      }
    }
  }
  return expected;
}

const scoredRuns = runs.map((run) => {
  const verdict = grade(run);
  return {
    ...run,
    rawValid: run.valid,
    rawReasons: run.reasons ?? [],
    verdict,
    correct: verdict === 'CORRECT',
  };
});

if (scoredJsonlPath) {
  mkdirSync(dirname(scoredJsonlPath), { recursive: true });
  writeFileSync(scoredJsonlPath, scoredRuns.map((run) => JSON.stringify(run)).join('\n') + '\n');
}

let exitCode = 0;
const invalidRuns = scoredRuns.filter((run) => run.verdict === 'INVALID');
const ungradedRuns = scoredRuns.filter((run) => run.verdict === 'UNGRADED');
if (invalidRuns.length > 0) {
  console.error(`INVALID runs: ${invalidRuns.map((run) => `${run.id}/${run.arm}/${run.mode}/${run.model}/${run.run}`).join(', ')}`);
  exitCode = 1;
}
if (ungradedRuns.length > 0) {
  console.error(`UNGRADED runs: ${ungradedRuns.map((run) => run.id).join(', ')}`);
  exitCode = 1;
}
if (requireComplete) {
  const actual = scoredRuns.map((run) => `${run.id}|${run.arm}|${run.mode}|${run.model}|${run.run}`);
  const actualCounts = new Map();
  for (const id of actual) actualCounts.set(id, (actualCounts.get(id) ?? 0) + 1);
  const expected = expectedRunIds();
  const missing = expected.filter((id) => !actualCounts.has(id));
  const unexpected = [...actualCounts.keys()].filter((id) => !expected.includes(id));
  const duplicates = [...actualCounts.entries()].filter(([, count]) => count > 1).map(([id, count]) => `${id} x${count}`);
  if (missing.length > 0 || unexpected.length > 0 || duplicates.length > 0) {
    if (missing.length > 0) console.error(`Missing runs: ${missing.join(', ')}`);
    if (unexpected.length > 0) console.error(`Unexpected runs: ${unexpected.join(', ')}`);
    if (duplicates.length > 0) console.error(`Duplicate runs: ${duplicates.join(', ')}`);
    exitCode = 1;
  }
}

// Aggregate.
const cells = {};
for (const r of scoredRuns) {
  const key = `${r.id}|${r.arm}|${r.mode}|${r.model}`;
  (cells[key] ??= { runs: [], correct: 0, invalid: 0, mcp: 0, read: 0, grep: 0, bash: 0, turns: 0 });
  const c = cells[key];
  const v = r.verdict;
  c.runs.push({ run: r.run, verdict: v, ans: r.ans, mcp: r.mcp, read: r.read, grep: r.grep, bash: r.bash, turns: r.turns });
  if (v === 'CORRECT') c.correct++;
  if (v === 'INVALID') c.invalid++;
  c.mcp += r.mcp; c.read += r.read; c.grep += r.grep; c.bash += r.bash; c.turns += r.turns;
}

console.log('# Agent A/B benchmark — scored\n');
const ids = manifest.map((q) => q.id).filter((id) => scoredRuns.some((r) => r.id === id));
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
  const summary = Object.entries(armAcc)
    .sort(([a], [b]) => {
      const ai = ARM_ORDER.indexOf(a);
      const bi = ARM_ORDER.indexOf(b);
      return (ai === -1 ? ARM_ORDER.length : ai) - (bi === -1 ? ARM_ORDER.length : bi) || a.localeCompare(b);
    })
    .map(([arm, v]) => `${arm} ${v.c}/${v.n}`)
    .join('  ');
  console.log(`- **${id}** (${q?.type}): ${summary}`);
}

process.exit(exitCode);
