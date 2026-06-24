#!/usr/bin/env node
// Framework-app edge/node parity: OmniWeave vs upstream codegraph on a REAL
// framework app. Tests iron-law ⑥ (OW must not be weaker than CG) at the place
// the war plan's framework-synthesizer-gap.txt only grepped function NAMES:
// does OW actually extract the same store-action function nodes AND emit the
// same dispatch edges as CG on a real Pinia/Vuex/Redux app?
//
// Two layers, both must hold for ⑥:
//   (1) extraction: object-literal store members (defineStore options-form
//       actions, Vuex module methods) become function nodes at all.
//   (2) synthesis: pinia-store / vuex-dispatch / redux-thunk edges are emitted.
//
// Usage: node measure.mjs <ow.db> <cg.db> [storePathRegex]
import { DatabaseSync } from 'node:sqlite';

const [owPath, cgPath] = [process.argv[2], process.argv[3]];
if (!owPath || !cgPath) {
  console.error('usage: node measure.mjs <ow.db> <cg.db> [storePathRegex]');
  process.exit(1);
}

// node:sqlite has no REGEXP function, so the store-file surface is matched with
// a LIKE over the common store path fragments instead of a regex.
function probeSafe(dbPath, storeAlts) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const totalNodes = one(`SELECT count(*) c FROM nodes`).c;
  const totalEdges = one(`SELECT count(*) c FROM edges`).c;
  const totalFns = one(`SELECT count(*) c FROM nodes WHERE kind IN ('function','method')`).c;
  const likeClause = storeAlts.map(() => `file_path LIKE ?`).join(' OR ');
  const storeFns = one(
    `SELECT count(*) c FROM nodes WHERE kind IN ('function','method') AND (${likeClause})`,
    ...storeAlts.map((s) => `%${s}%`)
  ).c;
  let synth = {};
  for (const r of db
    .prepare(
      `SELECT json_extract(metadata,'$.synthesizedBy') s, count(*) c FROM edges
       WHERE json_extract(metadata,'$.synthesizedBy') IS NOT NULL GROUP BY s ORDER BY c DESC`
    )
    .all()) {
    synth[r.s] = r.c;
  }
  db.close();
  return { totalNodes, totalEdges, totalFns, storeFns, synth };
}

const storeAlts = ['/store/', '/stores/', 'store.js', 'store.ts'];
const ow = probeSafe(owPath, storeAlts);
const cg = probeSafe(cgPath, storeAlts);

const synthKeys = [...new Set([...Object.keys(ow.synth), ...Object.keys(cg.synth)])].sort();
console.log('## Framework-app parity — OmniWeave vs codegraph\n');
console.log('| metric | OmniWeave | codegraph | ⑥ (OW≥CG?) |');
console.log('|---|---|---|---|');
const row = (name, o, c) => console.log(`| ${name} | ${o} | ${c} | ${o >= c ? 'OK' : '**OW WEAKER**'} |`);
row('total nodes', ow.totalNodes, cg.totalNodes);
row('total edges', ow.totalEdges, cg.totalEdges);
row('function+method nodes', ow.totalFns, cg.totalFns);
row('store-file fn/method nodes', ow.storeFns, cg.storeFns);
for (const k of synthKeys) row(`edges synthesizedBy=${k}`, ow.synth[k] || 0, cg.synth[k] || 0);

const weaker = [];
if (ow.totalFns < cg.totalFns) weaker.push(`function nodes (${ow.totalFns} < ${cg.totalFns})`);
if (ow.storeFns < cg.storeFns) weaker.push(`store-file fn nodes (${ow.storeFns} < ${cg.storeFns})`);
for (const k of synthKeys) if ((ow.synth[k] || 0) < (cg.synth[k] || 0)) weaker.push(`${k} edges (${ow.synth[k] || 0} < ${cg.synth[k] || 0})`);
console.log(`\n**⑥ verdict:** ${weaker.length ? 'OW is WEAKER than CG on: ' + weaker.join('; ') : 'OW ≥ CG on every measured framework metric.'}`);
