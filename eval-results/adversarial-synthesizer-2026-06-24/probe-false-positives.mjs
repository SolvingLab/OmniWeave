#!/usr/bin/env node
// Adversarial false-positive battery for the cross-boundary dispatch synthesizers.
// Each trap is DESIGNED to look like a dispatch the synthesizer targets, but is NOT one —
// the precision gate must refuse it. A synthesizer that emits an edge here has fabricated a
// wrong edge (错边比漏边 violated). Fail-closed: any forbidden edge, or an indexing/query
// error, exits non-zero. Posture: challenge OmniWeave's own advantage — do NOT trust the
// precision gates, prove them under hostile input.
//
// Usage: OW=<dist/bin/omniweave.js> node probe-false-positives.mjs
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const OW = process.env.OW || path.resolve('dist/bin/omniweave.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adversarial-synth-'));
const fail = (m) => { console.error(`INVALID: ${m}`); process.exit(1); };
const w = (rel, body) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };

// Each trap: files + the synthesizedBy that must NOT appear (with an optional forbidden target).
const TRAPS = {
  // .delay() on a function with NO @shared_task/@app.task decorator — not a celery task.
  celery: { sb: 'celery-dispatch', files: {
    'src/tasks.py': 'def send_email(x):\n    return x\n',
    'src/views.py': 'from .tasks import send_email\ndef signup(r):\n    send_email.delay(r)\n',
  }},
  // perform_async on a class that does NOT include Sidekiq::Worker|Job.
  sidekiq: { sb: 'sidekiq-dispatch', files: {
    'src/plain.rb': 'class PlainClass\n  def perform(x)\n    x\n  end\nend\n',
    'src/svc.rb': 'class Svc\n  def go(u)\n    PlainClass.perform_async(u)\n  end\nend\n',
  }},
  // .Send on a NON-mediator receiver (httpClient), even though a real handler exists.
  mediatr: { sb: 'mediatr-dispatch', files: {
    'src/h.cs': 'namespace S {\n  public class FooCommand { public int Id; }\n  public class FooHandler : IRequestHandler<FooCommand,bool> {\n    public async Task<bool> Handle(FooCommand r, CancellationToken c){ return true; }\n  }\n}\n',
    'src/ctrl.cs': 'namespace S {\n  public class Ctrl {\n    private HttpClient httpClient;\n    public async Task Go(){ var x = new FooCommand(); await httpClient.Send(x); }\n  }\n}\n',
  }},
  // dispatch() of an ORDINARY same-named function, not a thunk constant.
  redux: { sb: 'redux-thunk', files: {
    'src/api.ts': 'export function fetchUser(id){ return {id}; }\n',
    'src/slice.ts': "import { createAsyncThunk } from '@reduxjs/toolkit';\nimport { fetchUser } from './api';\nexport const refresh = createAsyncThunk('x', async (_, { dispatch }) => { dispatch(fetchUser(1)); });\n",
  }},
  // SAME struct name in two unrelated translation units, no shared header — must not cross-wire
  // a.c's dispatch to b.c's handler. (Intra-TU run_a->handler_a is a correct TRUE positive.)
  cfnptr: { sb: 'fn-pointer-dispatch', forbidTarget: 'handler_b', files: {
    'src/a.c': 'struct ops { int (*fn)(int); };\nint handler_a(int x){ return x; }\nstatic struct ops A = { handler_a };\nint run_a(struct ops *o){ return o->fn(1); }\n',
    'src/b.c': 'struct ops { int (*fn)(int); };\nint handler_b(int x){ return x+1; }\n',
  }},
  // subprocess with a RUNTIME-computed path — must skip, never fabricate a crossLang edge.
  crosslang: { sbContains: 'cross', files: {
    'src/run.py': 'import subprocess\ndef run(name):\n    subprocess.run(["Rscript", f"{name}.R"])\n',
    'src/real.R': 'cat("hi")\n',
  }},
};

let pass = 0;
for (const [name, t] of Object.entries(TRAPS)) {
  const dir = path.join(root, name);
  for (const [rel, body] of Object.entries(t.files)) w(path.join(name, rel), body);
  try { execFileSync('node', [OW, 'init', dir], { stdio: 'ignore' }); }
  catch (e) { fail(`indexing trap ${name} failed: ${e.message}`); }
  const dbPath = path.join(dir, '.omniweave', 'omniweave.db');
  if (!fs.existsSync(dbPath)) fail(`no db for trap ${name}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const heur = db.prepare(`SELECT s.name src, t.name tgt, json_extract(e.metadata,'$.synthesizedBy') sb FROM edges e JOIN nodes s ON s.id=e.source JOIN nodes t ON t.id=e.target WHERE e.provenance='heuristic'`).all();
  db.close();
  let forbidden;
  if (t.forbidTarget) forbidden = heur.filter((e) => e.sb === t.sb && e.tgt === t.forbidTarget);
  else if (t.sbContains) forbidden = heur.filter((e) => (e.sb || '').toLowerCase().includes(t.sbContains));
  else forbidden = heur.filter((e) => e.sb === t.sb);
  if (forbidden.length > 0) {
    console.error(`✗ FAIL [${name}] fabricated: ${JSON.stringify(forbidden.map((e) => `${e.src}->${e.tgt}(${e.sb})`))}`);
  } else {
    console.log(`✓ PASS [${name}] no false ${t.sb || t.sbContains} edge`);
    pass++;
  }
}
fs.rmSync(root, { recursive: true, force: true });
const total = Object.keys(TRAPS).length;
if (pass !== total) fail(`${total - pass}/${total} traps fabricated a false edge`);
console.log(`\nPASS: ${pass}/${total} adversarial traps — every precision gate refused the hostile input (0 fabricated edges).`);
