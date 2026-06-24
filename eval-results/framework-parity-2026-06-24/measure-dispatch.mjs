#!/usr/bin/env node
// Cross-boundary dispatch-synthesizer parity: index each minimal real-idiom
// framework fixture with BOTH OmniWeave and upstream codegraph, then compare the
// synthesized framework dispatch edge AND the total edge count. Iron-law-6 gate:
// OmniWeave (a superset fork) must never emit fewer edges than codegraph.
//
// FAIL-CLOSED: a missing DB, a query error, or OW < CG on any fixture exits
// non-zero — a green run is only printed when every fixture is verified OW >= CG.
//
// Usage: node measure-dispatch.mjs            (defaults to ./dispatch-fixtures)
//        OW=<omniweave.js> CG=<codegraph.js> node measure-dispatch.mjs <fixtures-dir>
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '../..');
const OW = process.env.OW || path.join(ENGINE, 'dist/bin/omniweave.js');
const CG = process.env.CG || path.join(ENGINE, 'research/2026-06-23-codegraph-ecosystem/repos/codegraph/dist/bin/codegraph.js');
const FIX = path.resolve(process.argv[2] || path.join(HERE, 'dispatch-fixtures'));

// fixture dir -> the synthesizedBy tag whose presence is the ground-truth bridge.
const FRAMEWORKS = {
  celery: 'celery-dispatch',
  spring: 'spring-event',
  mediatr: 'mediatr-dispatch',
  sidekiq: 'sidekiq-dispatch',
  laravel: 'laravel-event',
};

const fail = (msg) => { console.error(`INVALID: ${msg}`); process.exit(1); };

function index(bin, dir, hidden) {
  fs.rmSync(path.join(dir, hidden), { recursive: true, force: true });
  try {
    execFileSync('node', [bin, 'init', dir], { stdio: 'ignore' });
  } catch (e) {
    fail(`indexing ${dir} with ${path.basename(bin)} failed: ${e.message}`);
  }
  const db = path.join(dir, hidden, `${hidden.slice(1)}.db`);
  if (!fs.existsSync(db)) fail(`no database produced at ${db}`);
  return db;
}

function counts(dbPath, sb) {
  let db;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); }
  catch (e) { fail(`cannot open ${dbPath}: ${e.message}`); }
  const fw = db.prepare(`SELECT count(*) c FROM edges WHERE json_extract(metadata,'$.synthesizedBy')=?`).get(sb).c;
  const total = db.prepare(`SELECT count(*) c FROM edges`).get().c;
  db.close();
  return { fw, total };
}

const rows = [];
let allPass = true;
for (const [fw, sb] of Object.entries(FRAMEWORKS)) {
  const dir = path.join(FIX, fw);
  if (!fs.existsSync(dir)) fail(`fixture missing: ${dir}`);
  const owDb = index(OW, dir, '.omniweave');
  const cgDb = index(CG, dir, '.codegraph');
  const ow = counts(owDb, sb);
  const cg = counts(cgDb, sb);
  // Iron-law-6: OW must emit >= CG on BOTH the framework bridge and total edges.
  const pass = ow.fw >= cg.fw && cg.fw >= 1 && ow.total >= cg.total;
  if (!pass) allPass = false;
  rows.push({ fw, sb, owFw: ow.fw, cgFw: cg.fw, owTotal: ow.total, cgTotal: cg.total, pass });
}

console.log(`\nDispatch-synthesizer parity — OmniWeave vs codegraph (${FIX})\n`);
console.log('framework  | synthesizedBy     | OW fw | CG fw | OW total | CG total | OW>=CG');
console.log('-----------|-------------------|-------|-------|----------|----------|-------');
for (const r of rows) {
  console.log(
    `${r.fw.padEnd(10)} | ${r.sb.padEnd(17)} | ${String(r.owFw).padEnd(5)} | ${String(r.cgFw).padEnd(5)} | ` +
    `${String(r.owTotal).padEnd(8)} | ${String(r.cgTotal).padEnd(8)} | ${r.pass ? 'YES' : 'NO'}`
  );
}
if (!allPass) fail('at least one fixture has OW < CG (iron-law-6 violated)');
console.log(`\nPASS: all ${rows.length} fixtures verified OmniWeave >= codegraph (framework edge present, total edges not fewer).`);
