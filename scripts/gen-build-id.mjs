#!/usr/bin/env node
// Stamp dist/.build-id with a deterministic content hash of the compiled output.
//
// Why: the daemon/proxy rendezvous on a version string so a fresh client never
// pipes through a stale daemon (src/mcp/proxy.ts). But `npm run build` does NOT
// bump package.json's version, so a dev rebuild produces NEW code under the SAME
// version — and the version-string check waves it through, letting a long-lived
// daemon serve stale logic while claiming to be current (the "the tool lied to
// me" failure). Hashing the emitted JS makes the rendezvous datum track the
// actual build, so same-version-different-build is detected and the client
// falls back to in-process (current code) instead of trusting the stale daemon.
//
// Deterministic: identical sources → identical hash → no false skew on a no-op
// rebuild. Content-based, so an mtime-only change (git checkout) is ignored.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(process.cwd(), 'dist');

/** All compiled .js under dist/, sorted for a stable, order-independent hash. */
function collectJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

try {
  statSync(DIST);
} catch {
  console.error('[gen-build-id] dist/ not found — run tsc first');
  process.exit(1);
}

const files = collectJsFiles(DIST).sort();
const hash = createHash('sha256');
for (const file of files) {
  // Include the dist-relative path so a rename alone changes the id.
  hash.update(file.slice(DIST.length + 1));
  hash.update('\0');
  hash.update(readFileSync(file));
  hash.update('\0');
}
const buildId = hash.digest('hex').slice(0, 12);
writeFileSync(join(DIST, '.build-id'), buildId + '\n', 'utf8');
console.log(`[gen-build-id] ${files.length} js files -> dist/.build-id ${buildId}`);
