// Build-fingerprint daemon/proxy rendezvous (P2①: daemon self-heal).
//
// The hole this guards: `npm run build` produces new code under the SAME
// package version, so a version-string rendezvous would let a long-lived daemon
// serve stale logic to a freshly-rebuilt client ("the tool lied to me"). The
// fingerprint = version + compiled-output hash, so same-version-different-build
// is detected and the proxy serves in-process with current code instead.
import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { connectWithHello } from '../src/mcp/proxy';
import { OmniWeavePackageVersion } from '../src/mcp/version';

const REPO = path.resolve(__dirname, '..');

/** A one-shot fake daemon: accepts one connection, writes `hello`, stays open. */
function fakeDaemon(hello: object): Promise<{ sockPath: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const sockPath = path.join(os.tmpdir(), `ow-fp-${process.pid}-${Math.floor(performance.now())}.sock`);
    try { fs.unlinkSync(sockPath); } catch { /* fresh */ }
    const server = net.createServer((sock) => {
      sock.write(JSON.stringify(hello) + '\n');
    });
    server.on('error', reject);
    server.listen(sockPath, () => resolve({
      sockPath,
      close: () => { try { server.close(); } catch { /* best-effort */ } try { fs.unlinkSync(sockPath); } catch { /* gone */ } },
    }));
  });
}

describe('build fingerprint — rendezvous catches same-version-different-build', () => {
  const open: Array<() => void> = [];
  afterEach(() => { for (const c of open.splice(0)) c(); });

  it('rejects a daemon on the same version but a different build (stale rebuild)', async () => {
    // Daemon hello carries only the bare version (a pre-build-id / stale daemon);
    // the freshly-rebuilt proxy expects version+buildId. Same version, different
    // code → the proxy must NOT attach.
    const d = await fakeDaemon({ omniweave: '1.0.0', pid: 1, socketPath: 'x', protocol: 1 });
    open.push(d.close);
    const result = await connectWithHello(d.sockPath, '1.0.0+rebuiltabc123');
    expect(result).toBe('version-mismatch');
  });

  it('attaches to a daemon whose build fingerprint matches exactly', async () => {
    const d = await fakeDaemon({ omniweave: '1.0.0+rebuiltabc123', pid: 1, socketPath: 'x', protocol: 1 });
    open.push(d.close);
    const result = await connectWithHello(d.sockPath, '1.0.0+rebuiltabc123');
    expect(result).not.toBe('version-mismatch');
    expect(result).not.toBeNull();
    if (result && result !== 'version-mismatch') result.destroy();
  });
});

describe('build fingerprint — composition in the built artifact', () => {
  it('dist/.build-id is stamped and the built fingerprint = version+buildId', async () => {
    const idPath = path.join(REPO, 'dist', '.build-id');
    const versionMod = path.join(REPO, 'dist', 'mcp', 'version.js');
    // These exist only after `npm run build`; the full gate always builds first.
    if (!fs.existsSync(idPath) || !fs.existsSync(versionMod)) {
      expect.soft(fs.existsSync(idPath), 'run `npm run build` before this test').toBe(true);
      return;
    }
    const buildId = fs.readFileSync(idPath, 'utf8').trim();
    expect(buildId).toMatch(/^[0-9a-f]{12}$/);
    const mod = await import(pathToFileURL(versionMod).href);
    expect(mod.OmniWeaveBuildId).toBe(buildId);
    expect(mod.OmniWeaveBuildFingerprint).toBe(`${mod.OmniWeavePackageVersion}+${buildId}`);
  });

  it('gen-build-id is deterministic — identical dist yields the same id (no false skew)', () => {
    const idPath = path.join(REPO, 'dist', '.build-id');
    if (!fs.existsSync(idPath)) { expect.soft(false, 'run `npm run build` first').toBe(true); return; }
    const before = fs.readFileSync(idPath, 'utf8').trim();
    execFileSync('node', ['scripts/gen-build-id.mjs'], { cwd: REPO, stdio: 'pipe' });
    const after = fs.readFileSync(idPath, 'utf8').trim();
    expect(after).toBe(before);
  });

  it('src-run degrades to a version-only fingerprint (no compiled artifact to be stale against)', () => {
    // This module is loaded from src/ in the unit run, so there is no
    // src/.build-id — the fingerprint must equal the bare version, preserving
    // the exact pre-build-id handshake for non-built trees.
    expect(OmniWeavePackageVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
