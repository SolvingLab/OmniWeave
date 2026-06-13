/**
 * Directory Management
 *
 * Manages the .omniweave/ directory structure for OmniWeave data.
 */

import * as fs from 'fs';
import * as path from 'path';

/** The default per-project data directory name. */
const DEFAULT_OMNIWEAVE_DIR = '.omniweave';

let warnedBadDirName = false;

/**
 * Resolve the per-project data directory name, honoring the `OMNIWEAVE_DIR`
 * environment override (default `.omniweave`). The override is a single path
 * segment that lives in the project root.
 *
 * Why this exists: two environments that share one working tree must NOT share
 * one `.omniweave/` — most concretely Windows-native and WSL (issue #636). The
 * daemon lockfile (`.omniweave/daemon.pid`) records a platform-specific pid and
 * socket path (a Windows named pipe vs a WSL Unix socket), and SQLite file
 * locking across the WSL2 ↔ Windows filesystem boundary is unreliable, so two
 * daemons sharing one index risks corruption. Setting `OMNIWEAVE_DIR=.omniweave-win`
 * on one side gives each environment its own index in the same tree.
 *
 * Read live (not captured at load) so it is both process-accurate and testable.
 * An override that isn't a plain directory name — empty, containing a path
 * separator, `.`, `..`/traversal, or absolute — is ignored (we keep the
 * default) rather than risk writing the index outside the project or into the
 * project root itself; we warn once to stderr so the misconfiguration is seen.
 */
export function omniWeaveDirName(): string {
  const raw = process.env.OMNIWEAVE_DIR?.trim();
  if (!raw) return DEFAULT_OMNIWEAVE_DIR;
  const invalid =
    raw === '.' ||
    raw.includes('..') ||
    raw.includes('/') ||
    raw.includes('\\') ||
    path.isAbsolute(raw);
  if (invalid) {
    if (!warnedBadDirName) {
      warnedBadDirName = true;
      // stderr only — stdout is the MCP protocol channel.
      console.warn(
        `[omniweave] Ignoring invalid OMNIWEAVE_DIR="${raw}" — it must be a plain ` +
          `directory name (no path separators, no "..", not absolute). Using "${DEFAULT_OMNIWEAVE_DIR}".`
      );
    }
    return DEFAULT_OMNIWEAVE_DIR;
  }
  return raw;
}

/**
 * OmniWeave directory name — a load-time snapshot of {@link omniWeaveDirName}.
 * A running process's environment is fixed, so this equals the live value;
 * it's kept as a stable string export for backward compatibility. Internal code
 * resolves the name through {@link omniWeaveDirName} / {@link getOmniWeaveDir}
 * so the `OMNIWEAVE_DIR` override always applies.
 */
export const OMNIWEAVE_DIR = omniWeaveDirName();

/**
 * Is `name` (a single path segment) a OmniWeave data directory? Matches the
 * default `.omniweave`, the active `OMNIWEAVE_DIR` override, and any
 * `.omniweave-*` sibling. File-watching and the indexer skip ALL of these, so
 * when two environments share one working tree (Windows + WSL, issue #636)
 * neither indexes or watches the other's index directory.
 *
 * The legacy `.codegraph` / `.codegraph-*` names are also skipped: OmniWeave is
 * a fork of upstream codegraph, so the two tools can coexist in one working
 * tree. Skipping the sibling's index dir keeps OmniWeave from watching or
 * walking the other tool's continuously-rewritten SQLite WAL files.
 */
export function isOmniWeaveDataDir(name: string): boolean {
  return (
    name === DEFAULT_OMNIWEAVE_DIR ||
    name === omniWeaveDirName() ||
    name.startsWith(DEFAULT_OMNIWEAVE_DIR + '-') ||
    name === '.codegraph' ||
    name.startsWith('.codegraph-')
  );
}

/**
 * Get the .omniweave directory path for a project
 */
export function getOmniWeaveDir(projectRoot: string): string {
  return path.join(projectRoot, omniWeaveDirName());
}

/**
 * Check if a project has been initialized with OmniWeave
 * Requires both .omniweave/ directory AND omniweave.db to exist
 */
export function isInitialized(projectRoot: string): boolean {
  const omniweaveDir = getOmniWeaveDir(projectRoot);
  if (!fs.existsSync(omniweaveDir) || !fs.statSync(omniweaveDir).isDirectory()) {
    return false;
  }
  // Must have omniweave.db, not just .omniweave folder
  const dbPath = path.join(omniweaveDir, 'omniweave.db');
  return fs.existsSync(dbPath);
}

/**
 * Find the nearest parent directory containing .omniweave/
 *
 * Walks up from the given path to find a OmniWeave-initialized project,
 * similar to how git finds .git/ directories.
 *
 * @param startPath - Directory to start searching from
 * @returns The project root containing .omniweave/, or null if not found
 */
export function findNearestOmniWeaveRoot(startPath: string): string | null {
  let current = path.resolve(startPath);
  const root = path.parse(current).root;

  while (current !== root) {
    if (isInitialized(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break; // Reached filesystem root
    current = parent;
  }

  // Check root as well
  if (isInitialized(current)) {
    return current;
  }

  return null;
}

/**
 * Contents of `.omniweave/.gitignore`. A single wildcard ignore keeps every
 * transient file in the index dir — the database, `daemon.pid`, the socket,
 * logs, cache, and anything future versions add — out of git, without having
 * to enumerate each name (issues #788, #492, #484). Older versions wrote an
 * explicit allowlist that never listed `daemon.pid` or the socket, so those
 * runtime files were silently committed.
 */
const GITIGNORE_CONTENT = `# OmniWeave data files — local to each machine, not for committing.
# Ignore everything in .omniweave/ except this file itself, so transient
# files (the database, daemon.pid, sockets, logs) never show up in git.
*
!.gitignore
`;

/** Header line that prefixes every .gitignore OmniWeave has auto-generated. */
const GITIGNORE_MARKER = '# OmniWeave data files';

/**
 * Is `content` a stale OmniWeave-generated `.gitignore` that should be
 * regenerated in place? True when it carries our header but predates the
 * wildcard ignore (it has no bare `*` line) — i.e. one of the old explicit
 * allowlists (`*.db`, `cache/`, `.dirty`, …) that never ignored `daemon.pid`
 * or the socket (issue #788). A file WITHOUT our header is user-authored and
 * is left untouched; one that already has the wildcard is current. Matching
 * on the header (not a byte-exact list of past defaults) heals every old
 * variant — v0.7.x through 0.9.9 — and is idempotent once upgraded.
 */
function isStaleDefaultGitignore(content: string): boolean {
  if (!content.trimStart().startsWith(GITIGNORE_MARKER)) return false;
  return !content.split('\n').some((line) => line.trim() === '*');
}

/**
 * Write `.omniweave/.gitignore` if it's absent, or upgrade a stale
 * OmniWeave-generated default in place; a user-customized file is left alone.
 * Best-effort — returns `false` only if a needed write failed.
 */
function ensureGitignore(gitignorePath: string): boolean {
  let existing: string | null;
  try {
    existing = fs.readFileSync(gitignorePath, 'utf-8');
  } catch {
    existing = null; // absent (ENOENT) or unreadable — (re)create below
  }
  // Current default or a user-authored file: nothing to do.
  if (existing !== null && !isStaleDefaultGitignore(existing)) return true;
  try {
    fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the .omniweave directory structure
 * Note: Only throws if omniweave.db already exists, not just if .omniweave/ exists.
 */
export function createDirectory(projectRoot: string): void {
  const omniweaveDir = getOmniWeaveDir(projectRoot);
  const dbPath = path.join(omniweaveDir, 'omniweave.db');

  // Only throw if OmniWeave is actually initialized (db exists)
  // .omniweave/ folder alone is fine
  if (fs.existsSync(dbPath)) {
    throw new Error(`OmniWeave already initialized in ${projectRoot}`);
  }

  // Create main directory (if it doesn't exist)
  fs.mkdirSync(omniweaveDir, { recursive: true });

  // Write .gitignore inside .omniweave (create if absent, upgrade a stale
  // pre-wildcard default left by an older version — issue #788).
  ensureGitignore(path.join(omniweaveDir, '.gitignore'));
}

/**
 * Remove the .omniweave directory
 */
export function removeDirectory(projectRoot: string): void {
  const omniweaveDir = getOmniWeaveDir(projectRoot);

  if (!fs.existsSync(omniweaveDir)) {
    return;
  }

  // Verify .omniweave is a real directory, not a symlink pointing elsewhere
  const lstat = fs.lstatSync(omniweaveDir);
  if (lstat.isSymbolicLink()) {
    // Only remove the symlink itself, never follow it for recursive delete
    fs.unlinkSync(omniweaveDir);
    return;
  }

  if (!lstat.isDirectory()) {
    // Not a directory - remove the single file
    fs.unlinkSync(omniweaveDir);
    return;
  }

  // Recursively remove directory
  fs.rmSync(omniweaveDir, { recursive: true, force: true });
}

/**
 * Get all files in the .omniweave directory
 */
export function listDirectoryContents(projectRoot: string): string[] {
  const omniweaveDir = getOmniWeaveDir(projectRoot);

  if (!fs.existsSync(omniweaveDir)) {
    return [];
  }

  const files: string[] = [];

  function walkDir(dir: string, prefix: string = ''): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      // Skip symlinks to prevent following links outside .omniweave
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        walkDir(path.join(dir, entry.name), relativePath);
      } else {
        files.push(relativePath);
      }
    }
  }

  walkDir(omniweaveDir);
  return files;
}

/**
 * Get the total size of the .omniweave directory in bytes
 */
export function getDirectorySize(projectRoot: string): number {
  const omniweaveDir = getOmniWeaveDir(projectRoot);

  if (!fs.existsSync(omniweaveDir)) {
    return 0;
  }

  let totalSize = 0;

  function walkDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip symlinks to prevent following links outside .omniweave
      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else {
        const stats = fs.statSync(fullPath);
        totalSize += stats.size;
      }
    }
  }

  walkDir(omniweaveDir);
  return totalSize;
}

/**
 * Ensure a subdirectory exists within .omniweave
 */
export function ensureSubdirectory(projectRoot: string, subdirName: string): string {
  if (subdirName.includes('..') || subdirName.includes(path.sep) || subdirName.includes('/')) {
    throw new Error(`Invalid subdirectory name: ${subdirName}`);
  }

  const subdirPath = path.join(getOmniWeaveDir(projectRoot), subdirName);

  if (!fs.existsSync(subdirPath)) {
    fs.mkdirSync(subdirPath, { recursive: true });
  }

  return subdirPath;
}

/**
 * Check if the .omniweave directory has valid structure
 */
export function validateDirectory(projectRoot: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const omniweaveDir = getOmniWeaveDir(projectRoot);

  if (!fs.existsSync(omniweaveDir)) {
    errors.push('OmniWeave directory does not exist');
    return { valid: false, errors };
  }

  if (!fs.statSync(omniweaveDir).isDirectory()) {
    errors.push('.omniweave exists but is not a directory');
    return { valid: false, errors };
  }

  // Auto-repair / upgrade .gitignore (non-critical file). A missing one is
  // recreated; a stale pre-wildcard default that never ignored daemon.pid is
  // regenerated in place (issue #788); a user-authored file is left alone.
  const gitignorePath = path.join(omniweaveDir, '.gitignore');
  const existedBefore = fs.existsSync(gitignorePath);
  if (!ensureGitignore(gitignorePath) && !existedBefore) {
    // Only a missing-and-uncreatable file is surfaced; a failed in-place
    // upgrade of an existing file is non-fatal — the index still works.
    errors.push('.gitignore missing in .omniweave directory and could not be created');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
