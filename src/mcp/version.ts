/**
 * Resolved package version, computed once at module load.
 *
 * The version string is the rendezvous datum between cooperating daemon and
 * proxy processes: the daemon advertises its version in the hello line, and
 * the proxy refuses to share IPC across a mismatch (falls back to direct
 * mode). Keeping the resolution in one place avoids drift between the CLI
 * `--version` output (which reads `package.json` directly) and the daemon
 * handshake.
 *
 * Resolution strategy: read the bundled `package.json` two levels up from
 * this file — same relative position whether we're loaded from `src/mcp/` or
 * the `dist/mcp/` output, since `tsc` preserves the layout. If reading fails
 * (e.g. the package was unpacked oddly), fall back to "0.0.0-unknown" — a
 * sentinel that will never match a real version, so the proxy harmlessly
 * falls back to direct mode.
 */

import * as fs from 'fs';
import * as path from 'path';

function readPackageVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.version === 'string' && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // Fall through to sentinel.
  }
  return '0.0.0-unknown';
}

/**
 * Short content hash of the compiled output, stamped by `scripts/gen-build-id.mjs`
 * at build time into `dist/.build-id` (a sibling of this module's `dist/mcp/`
 * directory). Empty string when absent — a `src/`-run (tests), an old install
 * built before this stamp existed, or an oddly-unpacked package.
 *
 * The package version alone is NOT enough to tell two running processes apart:
 * `npm run build` produces new code under the SAME version, so the daemon/proxy
 * rendezvous (see {@link OmniWeaveBuildFingerprint}) would wave a stale daemon
 * through. The build id closes that hole.
 */
function readBuildId(): string {
  try {
    // `..` from dist/mcp/ → dist/.build-id (and from src/mcp/ → src/.build-id,
    // which never exists, so a src run degrades to version-only — correct: a
    // non-built tree has no compiled artifact to be stale against).
    const idPath = path.join(__dirname, '..', '.build-id');
    const raw = fs.readFileSync(idPath, 'utf8').trim();
    if (raw.length > 0) return raw;
  } catch {
    // No stamp — degrade to version-only rendezvous (the pre-build-id behavior).
  }
  return '';
}

export const OmniWeavePackageVersion = readPackageVersion();

/** Build id alone (empty when no `dist/.build-id` stamp is present). */
export const OmniWeaveBuildId = readBuildId();

/**
 * The rendezvous datum cooperating daemon and proxy processes compare to decide
 * whether they are running the SAME code. It is the package version plus the
 * build-content hash (`1.0.0+abcdef123456`), so a dev rebuild — new code, same
 * version — produces a different fingerprint and the proxy refuses to pipe
 * through the stale daemon (it serves the session in-process with current code
 * instead). Degrades to the bare version when no build id is stamped, preserving
 * the pre-build-id handshake exactly.
 */
export const OmniWeaveBuildFingerprint = OmniWeaveBuildId
  ? `${OmniWeavePackageVersion}+${OmniWeaveBuildId}`
  : OmniWeavePackageVersion;
