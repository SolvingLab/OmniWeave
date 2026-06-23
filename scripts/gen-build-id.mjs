#!/usr/bin/env node
// Stamp dist/.build-id with a deterministic content hash of the compiled output.
//
// Why: the daemon/proxy rendezvous on a version string so a fresh client never
// pipes through a stale daemon (src/mcp/proxy.ts). But `npm run build` does NOT
// bump package.json's version, so a dev rebuild produces NEW code under the SAME
// version — and the version-string check waves it through, letting a long-lived
// daemon serve stale logic while claiming to be current (the "the tool lied to
// me" failure). Hashing the emitted runtime artifacts makes the rendezvous datum
// track the actual build, so same-version-different-build is detected and the
// client falls back to in-process (current code) instead of the stale daemon.
//
// Hash covers every artifact the runtime LOADS: compiled `.js` (code), vendored
// tree-sitter `.wasm` (grammars), and `.sql` (schema) — a change to any of them
// is a behavior change. `.d.ts`/`.map` are excluded (type-only, never loaded),
// and `.build-id` itself is not `.js`/`.wasm`/`.sql` so there is no self-reference.
//
// Deterministic: identical artifacts → identical hash → no false skew on a no-op
// rebuild. Content-based, so an mtime-only change (git checkout) is ignored.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const RUNTIME_ARTIFACT = /\.(js|wasm|sql)$/;

/** Every runtime-loaded artifact under dist/, for a stable, order-independent hash. */
function collectRuntimeArtifacts(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectRuntimeArtifacts(full));
    else if (entry.isFile() && RUNTIME_ARTIFACT.test(entry.name)) out.push(full);
  }
  return out;
}

try {
  statSync(DIST);
} catch {
  console.error('[gen-build-id] dist/ not found — run tsc first');
  process.exit(1);
}

const files = collectRuntimeArtifacts(DIST).sort();
const hash = createHash('sha256');
for (const file of files) {
  // Include the dist-relative path so a rename alone changes the id.
  hash.update(file.slice(DIST.length + 1));
  hash.update('\0');
  hash.update(readFileSync(file));
  hash.update('\0');
}
const buildId = hash.digest('hex').slice(0, 12);
// Atomic stamp: write a temp file then rename, so an interrupted run can never
// leave a half-written .build-id that a concurrent reader would trust.
const target = join(DIST, '.build-id');
const tmp = `${target}.${process.pid}.tmp`;
writeFileSync(tmp, buildId + '\n', 'utf8');
renameSync(tmp, target);
console.log(`[gen-build-id] ${files.length} runtime artifacts -> dist/.build-id ${buildId}`);
