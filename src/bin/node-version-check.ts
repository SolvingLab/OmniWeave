/**
 * Node.js version compatibility check.
 *
 * Node 25.x has a V8 turboshaft WASM JIT Zone allocator bug that
 * reliably crashes OmniWeave with `Fatal process out of memory: Zone`
 * during tree-sitter grammar compilation. This module owns the
 * user-facing banner shown before exit. Kept side-effect-free so it's
 * safe to import from tests without triggering CLI bootstrap.
 */

/**
 * Build the bordered banner shown when OmniWeave detects an
 * unsupported Node.js major version (currently 25+). Pinned via unit
 * test so the recovery commands and override instructions can't be
 * silently stripped by future edits.
 *
 * Uses ASCII glyphs to stay readable on Windows OEM-codepage consoles
 * (see ../ui/glyphs.ts for the rationale).
 */
export function buildNode25BlockBanner(nodeVersion: string): string {
  const sep = '-'.repeat(72);
  return [
    sep,
    `[OmniWeave] Unsupported Node.js version: ${nodeVersion}`,
    sep,
    'Node.js 25.x has a V8 WASM JIT (turboshaft) Zone allocator bug that',
    'crashes with `Fatal process out of memory: Zone` when OmniWeave',
    'compiles tree-sitter grammars. OmniWeave WILL crash on this Node',
    'version mid-indexing. See https://github.com/SolvingLab/OmniWeave/issues/81',
    '',
    'Fix: install Node.js 22 LTS:',
    '  nvm install 22 && nvm use 22                          # nvm',
    '  brew install node@22 && brew link --overwrite --force node@22  # Homebrew',
    '',
    'To override (NOT recommended - you will likely OOM):',
    '  OMNIWEAVE_ALLOW_UNSAFE_NODE=1 omniweave ...',
    sep,
  ].join('\n');
}

/**
 * Lowest supported Node.js version. Matches the `engines` floor in
 * package.json. `node:sqlite` landed in Node 22.5, so a major-only check is not
 * precise enough: Node 22.0-22.4 must fail before the CLI reaches SQLite.
 */
export const MIN_NODE_MAJOR = 22;
export const MIN_NODE_MINOR = 5;
export const MIN_NODE_VERSION = `${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}`;

export function isNodeTooOld(nodeVersion: string): boolean {
  const [majorRaw, minorRaw = '0'] = nodeVersion.split('.');
  const major = Number.parseInt(majorRaw ?? '0', 10);
  const minor = Number.parseInt(minorRaw, 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return true;
  return major < MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor < MIN_NODE_MINOR);
}

/**
 * Build the bordered banner shown when OmniWeave detects a Node.js version below
 * {@link MIN_NODE_VERSION}. Pinned via unit test so the recovery commands and
 * the override env var can't be silently stripped by future edits.
 *
 * Uses ASCII glyphs to stay readable on Windows OEM-codepage consoles
 * (see ../ui/glyphs.ts for the rationale).
 */
export function buildNodeTooOldBanner(nodeVersion: string): string {
  const sep = '-'.repeat(72);
  return [
    sep,
    `[OmniWeave] Unsupported Node.js version: ${nodeVersion}`,
    sep,
    `OmniWeave requires Node.js ${MIN_NODE_VERSION} or newer. Older versions lack`,
    'node:sqlite, which OmniWeave uses for its local graph database, and are',
    'not tested or supported.',
    '',
    'Fix: install Node.js 22 LTS:',
    '  nvm install 22 && nvm use 22                          # nvm',
    '  brew install node@22 && brew link --overwrite --force node@22  # Homebrew',
    '',
    'To override (NOT recommended - unsupported):',
    '  OMNIWEAVE_ALLOW_UNSAFE_NODE=1 omniweave ...',
    sep,
  ].join('\n');
}
