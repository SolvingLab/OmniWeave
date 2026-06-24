// Build-fingerprint daemon/proxy rendezvous (P2①: daemon self-heal).
//
// The hole this guards: `npm run build` produces new code under the SAME
// package version, so a version-string rendezvous would let a long-lived daemon
// serve stale logic to a freshly-rebuilt client ("the tool lied to me"). The
// fingerprint = version + runtime-artifact hash, so same-version-different-build
// is detected and the proxy serves in-process with current code instead.
//
// Teeth map (which test goes red if a piece regresses):
//   - parseBuildId contract            → parseBuildId unit tests
//   - fingerprint composition          → composition test (built artifact)
//   - no false skew on no-op rebuild   → determinism test
//   - proxy DEFAULT uses the fingerprint (not bare version) → built-default test
//   - connectWithHello rejects a mismatch → rendezvous tests
//   - src-run degrades to version-only → degradation test
// The daemon-side hello wiring (daemon.ts advertises OmniWeaveBuildFingerprint)
// is covered by the composition test (the export it uses) plus the real-process
// smoke recorded in CHECKPOINT; a daemon-spawn test is kept out of this unit
// phase on purpose — process spawns are timing-sensitive and run separately.
import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { connectWithHello } from '../src/mcp/proxy';
import {
  OmniWeavePackageVersion,
  OmniWeaveBuildFingerprint,
  formatBuildFingerprint,
  parseBuildId,
  readCurrentBuildFingerprint,
  runtimeBuildSkew,
  runtimeBuildSkewMessage,
} from '../src/mcp/version';

const REPO = path.resolve(__dirname, '..');
let sockCounter = 0;

/** A fake daemon: writes `hello` on each connection, tracks every accepted
 *  socket so cleanup destroys them (no dangling handles leaking into vitest). */
function fakeDaemon(hello: object): Promise<{ sockPath: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const sockPath = path.join(os.tmpdir(), `ow-fp-${process.pid}-${sockCounter++}.sock`);
    try { fs.unlinkSync(sockPath); } catch { /* fresh */ }
    const accepted = new Set<net.Socket>();
    const server = net.createServer((sock) => {
      accepted.add(sock);
      sock.on('close', () => accepted.delete(sock));
      sock.write(JSON.stringify(hello) + '\n');
    });
    server.on('error', reject);
    server.listen(sockPath, () => resolve({
      sockPath,
      close: () => {
        for (const s of accepted) { try { s.destroy(); } catch { /* gone */ } }
        try { server.close(); } catch { /* best-effort */ }
        try { fs.unlinkSync(sockPath); } catch { /* gone */ }
      },
    }));
  });
}

describe('parseBuildId — only a clean hex hash becomes a build id', () => {
  it('accepts a 12-hex stamp (the gen-build-id shape), trimming the trailing newline', () => {
    expect(parseBuildId('cec948c12283\n')).toBe('cec948c12283');
  });
  it('trims surrounding whitespace', () => {
    expect(parseBuildId('  abc123def456  ')).toBe('abc123def456');
  });
  it('takes only the first line — a multi-line/corrupt file cannot embed a newline in the fingerprint', () => {
    expect(parseBuildId('abc123\nGARBAGE\nmore')).toBe('abc123');
    expect(parseBuildId('GARBAGE\nabc123')).toBe(''); // non-hex first line → degrade
  });
  it('rejects non-hex garbage, empty, whitespace-only, and over-long blobs → degrade to ""', () => {
    expect(parseBuildId('not a hash!')).toBe('');
    expect(parseBuildId('')).toBe('');
    expect(parseBuildId('   \n  ')).toBe('');
    expect(parseBuildId('a'.repeat(200))).toBe(''); // beyond a sha256 hex length
    expect(parseBuildId('abcde')).toBe('');          // shorter than the 6-char floor
  });
});

describe('runtime build skew helpers', () => {
  it('formats bare source runs and stamped dist builds consistently', () => {
    expect(formatBuildFingerprint('1.0.0', '')).toBe('1.0.0');
    expect(formatBuildFingerprint('1.0.0', 'abc123def456')).toBe('1.0.0+abc123def456');
  });

  it('detects when a long-lived runtime no longer matches the disk build', () => {
    expect(runtimeBuildSkew('1.0.0+abc123def456', '1.0.0+abc123def456')).toBeNull();
    const skew = runtimeBuildSkew('1.0.0+abc123def456', '1.0.0+fff999eee888');
    expect(skew).toEqual({
      loaded: '1.0.0+abc123def456',
      current: '1.0.0+fff999eee888',
    });
    expect(runtimeBuildSkewMessage(skew!)).toContain('OmniWeave MCP runtime is stale');
  });
});

describe('build fingerprint — rendezvous catches same-version-different-build', () => {
  const open: Array<() => void> = [];
  afterEach(() => { for (const c of open.splice(0)) c(); });

  it('rejects a daemon on the same version but a different build (stale rebuild)', async () => {
    // Daemon hello carries only the bare version (a pre-build-id / stale daemon);
    // the freshly-rebuilt proxy expects version+buildId. Same version, different
    // code → the proxy must NOT attach.
    const d = await fakeDaemon({ omniweave: '1.0.0', pid: 1, socketPath: 'x', protocol: 1 });
    open.push(d.close);
    expect(await connectWithHello(d.sockPath, '1.0.0+rebuiltabc123')).toBe('version-mismatch');
  });

  it('attaches to a daemon whose build fingerprint matches exactly', async () => {
    const d = await fakeDaemon({ omniweave: '1.0.0+rebuiltabc123', pid: 1, socketPath: 'x', protocol: 1 });
    open.push(d.close);
    const result = await connectWithHello(d.sockPath, '1.0.0+rebuiltabc123');
    expect(result).not.toBe('version-mismatch');
    expect(result).not.toBeNull();
    if (result && typeof result !== 'string') result.destroy();
  });

  it('rejects a daemon with a matching build but incompatible hello protocol', async () => {
    const d = await fakeDaemon({ omniweave: '1.0.0+rebuiltabc123', pid: 1, socketPath: 'x', protocol: 2 });
    open.push(d.close);
    expect(await connectWithHello(d.sockPath, '1.0.0+rebuiltabc123')).toBe('protocol-mismatch');
  });

  it('the proxy DEFAULT rendezvous datum is the build fingerprint, not the bare version (built artifact)', async () => {
    // Teeth for the wiring: load the BUILT proxy + version, where the fingerprint
    // carries a build id (≠ bare version). A fakeDaemon advertising the bare
    // version must be rejected by a DEFAULT-arg connect — which only happens if
    // the default is the fingerprint. If the default were reverted to the bare
    // version, the bare-version daemon would match and this test goes red.
    const proxyMod = path.join(REPO, 'dist', 'mcp', 'proxy.js');
    const versionMod = path.join(REPO, 'dist', 'mcp', 'version.js');
    if (!fs.existsSync(proxyMod) || !fs.existsSync(versionMod)) {
      expect.soft(fs.existsSync(proxyMod), 'run `npm run build` before this test').toBe(true);
      return;
    }
    const builtProxy = await import(pathToFileURL(proxyMod).href);
    const builtVersion = await import(pathToFileURL(versionMod).href);
    const F: string = builtVersion.OmniWeaveBuildFingerprint;
    const V: string = builtVersion.OmniWeavePackageVersion;
    expect(F).not.toBe(V); // precondition: a real build id is present

    const matching = await fakeDaemon({ omniweave: F, pid: 1, socketPath: 'x', protocol: 1 });
    open.push(matching.close);
    const okRes = await builtProxy.connectWithHello(matching.sockPath); // default arg
    expect(okRes).not.toBe('version-mismatch');
    if (okRes && typeof okRes !== 'string') okRes.destroy();

    const stale = await fakeDaemon({ omniweave: V, pid: 1, socketPath: 'x', protocol: 1 });
    open.push(stale.close);
    expect(await builtProxy.connectWithHello(stale.sockPath)).toBe('version-mismatch');
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
    expect(mod.OmniWeaveBuildFingerprint).toBe(`${mod.OmniWeavePackageVersion}+${buildId}`);
    expect(mod.readCurrentBuildFingerprint()).toBe(mod.OmniWeaveBuildFingerprint);
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
    // src/.build-id — the fingerprint must equal the bare version exactly,
    // preserving the pre-build-id handshake for non-built trees.
    expect(OmniWeavePackageVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(OmniWeaveBuildFingerprint).toBe(OmniWeavePackageVersion);
    expect(readCurrentBuildFingerprint()).toBe(OmniWeavePackageVersion);
  });
});
