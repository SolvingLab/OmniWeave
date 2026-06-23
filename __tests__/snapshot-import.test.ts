import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import OmniWeave from '../src/index';
import { DatabaseConnection, getDatabasePath } from '../src/db';
import { CURRENT_SCHEMA_VERSION } from '../src/db/migrations';
import { FileLock } from '../src/utils';
import {
  exportSnapshot,
  importSnapshot,
  verifySnapshot,
  SNAPSHOT_DATABASE_FILENAME,
  SNAPSHOT_FORMAT,
  SNAPSHOT_MANIFEST_FILENAME,
  type VerifySnapshotResult,
} from '../src/snapshot';

const BIN = path.resolve(__dirname, '../dist/bin/omniweave.js');
const SOURCE = `export function entry(): string {\n  return helper();\n}\n\nfunction helper(): string {\n  return 'ok';\n}\n`;
const CHANGED_SOURCE = `export function entry(): string {\n  return 'changed';\n}\n`;

function rmTree(dir: string): void {
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function writeProject(root: string, content = SOURCE): void {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), content);
}

async function indexProject(root: string): Promise<void> {
  const cg = OmniWeave.initSync(root);
  await cg.indexAll();
  cg.destroy();
}

function refreshSnapshotDatabaseManifest(outputDir: string): void {
  const dbPath = path.join(outputDir, SNAPSHOT_DATABASE_FILENAME);
  const manifest = readSnapshotManifestForTest(outputDir) as {
    files: { database: { bytes: number; sha256: string } };
  };
  const bytes = fs.statSync(dbPath).size;
  const sha256 = createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
  manifest.files.database.bytes = bytes;
  manifest.files.database.sha256 = sha256;
  writeSnapshotManifestForTest(outputDir, manifest);
}

function readSnapshotManifestForTest(outputDir: string): Record<string, unknown> {
  const manifestPath = path.join(outputDir, SNAPSHOT_MANIFEST_FILENAME);
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
}

function writeSnapshotManifestForTest(outputDir: string, manifest: Record<string, unknown>): void {
  const manifestPath = path.join(outputDir, SNAPSHOT_MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

function updateSnapshotManifestForTest(
  outputDir: string,
  update: (manifest: Record<string, unknown>) => void,
): void {
  const manifest = readSnapshotManifestForTest(outputDir);
  update(manifest);
  writeSnapshotManifestForTest(outputDir, manifest);
}

async function withFakeHome<T>(home: string, fn: () => T | Promise<T>): Promise<T> {
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return await fn();
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = oldUserProfile;
  }
}

describe('snapshot import and verify', () => {
  let sourceRoot: string;
  let targetRoot: string;
  let outputDir: string;

  beforeEach(async () => {
    sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-snapshot-source-'));
    targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-snapshot-target-'));
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-snapshot-bundle-'));
    writeProject(sourceRoot);
    writeProject(targetRoot);
    await indexProject(sourceRoot);
    await exportSnapshot(sourceRoot, outputDir, { omniweaveVersion: '9.9.9-test' });
  });

  afterEach(() => {
    rmTree(sourceRoot);
    rmTree(targetRoot);
    rmTree(outputDir);
  });

  it('rejects a snapshot when an artifact hash no longer matches the manifest', async () => {
    fs.appendFileSync(path.join(outputDir, SNAPSHOT_DATABASE_FILENAME), 'corrupt bytes');

    const result = await verifySnapshot(outputDir);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/hash mismatch/);
  });

  it('rejects snapshots from a newer snapshot format version', async () => {
    updateSnapshotManifestForTest(outputDir, (manifest) => {
      manifest.formatVersion = 999999;
    });

    const verification = await verifySnapshot(outputDir, { projectRoot: targetRoot });

    expect(verification.ok).toBe(false);
    expect(verification.errors.join('\n')).toContain('Unsupported snapshot format version');
    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/Invalid snapshot/);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);
  });

  it('rejects snapshots from a newer graph schema version', async () => {
    updateSnapshotManifestForTest(outputDir, (manifest) => {
      manifest.schemaVersion = 999999;
    });

    const verification = await verifySnapshot(outputDir, { projectRoot: targetRoot });

    expect(verification.ok).toBe(false);
    expect(verification.errors.join('\n')).toContain('Snapshot schema version 999999 is newer');
    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/Invalid snapshot/);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);
  });

  it('rejects snapshots whose database schema is newer than supported even when the manifest is current', async () => {
    const conn = DatabaseConnection.open(path.join(outputDir, SNAPSHOT_DATABASE_FILENAME));
    try {
      conn.getDb().prepare(
        'INSERT INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)'
      ).run(CURRENT_SCHEMA_VERSION + 1, Date.now(), 'future schema');
      conn.getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      conn.close();
    }
    refreshSnapshotDatabaseManifest(outputDir);

    const verification = await verifySnapshot(outputDir, { projectRoot: targetRoot });

    expect(verification.ok).toBe(false);
    expect(verification.errors.join('\n')).toContain('newer than this OmniWeave supports');
    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/Invalid snapshot/);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);
  });

  it('rejects snapshots whose manifest schema does not match the database schema', async () => {
    updateSnapshotManifestForTest(outputDir, (manifest) => {
      manifest.schemaVersion = CURRENT_SCHEMA_VERSION - 1;
    });

    const verification = await verifySnapshot(outputDir, { projectRoot: targetRoot });

    expect(verification.ok).toBe(false);
    expect(verification.errors.join('\n')).toContain('does not match manifest schemaVersion');
    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/Invalid snapshot/);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);
  });

  it('rejects snapshots whose manifest source fingerprint does not match the database', async () => {
    updateSnapshotManifestForTest(outputDir, (manifest) => {
      const sourceRoot = manifest.sourceRoot as Record<string, unknown>;
      sourceRoot.fingerprint = 'forged-fingerprint';
    });

    const verification = await verifySnapshot(outputDir, { projectRoot: targetRoot });

    expect(verification.ok).toBe(false);
    expect(verification.errors.join('\n')).toContain('sourceRoot.fingerprint');
    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/Invalid snapshot/);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);
  });

  it('rejects snapshots whose manifest graph counts do not match the database', async () => {
    updateSnapshotManifestForTest(outputDir, (manifest) => {
      const graph = manifest.graph as Record<string, unknown>;
      graph.nodeCount = 0;
    });

    const verification = await verifySnapshot(outputDir, { projectRoot: targetRoot });

    expect(verification.ok).toBe(false);
    expect(verification.errors.join('\n')).toContain('graph.nodeCount');
    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/Invalid snapshot/);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);
  });

  it('rejects snapshots with missing manifest sourceRoot before installing bytes', async () => {
    updateSnapshotManifestForTest(outputDir, (manifest) => {
      delete manifest.sourceRoot;
    });

    const verification = await verifySnapshot(outputDir, { projectRoot: targetRoot });

    expect(verification.ok).toBe(false);
    expect(verification.errors.join('\n')).toContain('sourceRoot must be an object');
    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/Invalid snapshot/);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);
  });

  it('rejects snapshot artifact symlinks even when the target bytes match the manifest', async () => {
    const dbPath = path.join(outputDir, SNAPSHOT_DATABASE_FILENAME);
    const realDbPath = path.join(outputDir, 'real-omniweave.db');
    fs.renameSync(dbPath, realDbPath);
    try {
      fs.symlinkSync(realDbPath, dbPath);
    } catch {
      fs.renameSync(realDbPath, dbPath);
      return;
    }

    const verification = await verifySnapshot(outputDir, { projectRoot: targetRoot });

    expect(verification.ok).toBe(false);
    expect(verification.errors.join('\n')).toContain('Snapshot artifact must not be a symlink');
    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/Invalid snapshot/);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);
  });

  it('imports a verified snapshot into an uninitialized project and keeps the graph usable', async () => {
    const result = await importSnapshot(outputDir, targetRoot);

    expect(result.manifest.format).toBe(SNAPSHOT_FORMAT);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(true);
    expect(result.staleness?.stale).toBe(false);

    const cg = OmniWeave.openSync(targetRoot);
    try {
      const matches = cg.searchNodes('entry', { limit: 5 });
      expect(matches.some((match) => match.node.name === 'entry')).toBe(true);
    } finally {
      cg.destroy();
    }
  });

  it('refuses stale target sources by default and leaves the target uninitialized', async () => {
    writeProject(targetRoot, CHANGED_SOURCE);

    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/Snapshot is stale/);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);

    const result = await importSnapshot(outputDir, targetRoot, { allowStale: true });
    expect(result.staleness?.stale).toBe(true);
    expect(result.staleness?.changedFiles).toContain('src/index.ts');
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(true);
  });

  it('rejects snapshots whose indexed file paths escape the target root', async () => {
    const conn = DatabaseConnection.open(path.join(outputDir, SNAPSHOT_DATABASE_FILENAME));
    try {
      const now = Date.now();
      conn.getDb().prepare(
        `INSERT OR REPLACE INTO files
          (path, content_hash, language, size, modified_at, indexed_at, node_count, errors)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('../outside.ts', 'unsafe-hash', 'typescript', 1, now, now, 0, '[]');
      conn.getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      conn.close();
    }
    refreshSnapshotDatabaseManifest(outputDir);

    const verification = await verifySnapshot(outputDir, { projectRoot: targetRoot });

    expect(verification.ok).toBe(false);
    expect(verification.errors.join('\n')).toContain('unsafe files.path');
    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/Invalid snapshot/);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);
  });

  it('rejects snapshots whose node file paths are unsafe', async () => {
    const conn = DatabaseConnection.open(path.join(outputDir, SNAPSHOT_DATABASE_FILENAME));
    try {
      conn.getDb().prepare('UPDATE nodes SET file_path = ? WHERE file_path = ?').run('/tmp/outside.ts', 'src/index.ts');
      conn.getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      conn.close();
    }
    refreshSnapshotDatabaseManifest(outputDir);

    const verification = await verifySnapshot(outputDir, { projectRoot: targetRoot });

    expect(verification.ok).toBe(false);
    expect(verification.errors.join('\n')).toContain('unsafe nodes.file_path');
    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/Invalid snapshot/);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);
  });

  it('rejects snapshots whose node file paths are not tracked files', async () => {
    const conn = DatabaseConnection.open(path.join(outputDir, SNAPSHOT_DATABASE_FILENAME));
    try {
      const now = Date.now();
      conn.getDb().prepare(
        `INSERT INTO nodes
          (id, kind, name, qualified_name, file_path, language, start_line, end_line, start_column, end_column, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('ghost-node', 'function', 'ghostPwn', 'ghostPwn', 'src/ghost.ts', 'typescript', 1, 1, 0, 0, now);
      conn.getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      conn.close();
    }
    refreshSnapshotDatabaseManifest(outputDir);

    const verification = await verifySnapshot(outputDir, { projectRoot: targetRoot });

    expect(verification.ok).toBe(false);
    expect(verification.errors.join('\n')).toContain('nodes.file_path values not present in files.path');
    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/Invalid snapshot/);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);
  });

  it('rejects snapshots whose unresolved reference file paths are unsafe', async () => {
    const conn = DatabaseConnection.open(path.join(outputDir, SNAPSHOT_DATABASE_FILENAME));
    try {
      const node = conn.getDb().prepare('SELECT id FROM nodes LIMIT 1').get() as { id: string } | undefined;
      expect(node).toBeDefined();
      conn.getDb().prepare(
        `INSERT INTO unresolved_refs
          (from_node_id, reference_name, reference_kind, line, col, candidates, file_path, language)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(node!.id, 'unsafeRef', 'call', 1, 1, '[]', 'src/../outside.ts', 'typescript');
      conn.getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      conn.close();
    }
    refreshSnapshotDatabaseManifest(outputDir);

    const verification = await verifySnapshot(outputDir, { projectRoot: targetRoot });

    expect(verification.ok).toBe(false);
    expect(verification.errors.join('\n')).toContain('unsafe unresolved_refs.file_path');
    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/Invalid snapshot/);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);
  });

  it('rejects snapshots whose unresolved reference file paths are not tracked files', async () => {
    const conn = DatabaseConnection.open(path.join(outputDir, SNAPSHOT_DATABASE_FILENAME));
    try {
      const node = conn.getDb().prepare('SELECT id FROM nodes LIMIT 1').get() as { id: string } | undefined;
      expect(node).toBeDefined();
      conn.getDb().prepare(
        `INSERT INTO unresolved_refs
          (from_node_id, reference_name, reference_kind, line, col, candidates, file_path, language)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(node!.id, 'ghostRef', 'call', 1, 1, '[]', 'src/ghost-ref.ts', 'typescript');
      conn.getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      conn.close();
    }
    refreshSnapshotDatabaseManifest(outputDir);

    const verification = await verifySnapshot(outputDir, { projectRoot: targetRoot });

    expect(verification.ok).toBe(false);
    expect(verification.errors.join('\n')).toContain('unresolved_refs.file_path values not present in files.path');
    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/Invalid snapshot/);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);
  });

  it('rejects import when the target OmniWeave directory is a symlink', async () => {
    const symlinkTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-snapshot-linked-index-'));
    try {
      try {
        fs.symlinkSync(symlinkTarget, path.join(targetRoot, '.omniweave'), 'dir');
      } catch {
        return;
      }

      await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/symlink/);
      expect(fs.existsSync(path.join(symlinkTarget, SNAPSHOT_DATABASE_FILENAME))).toBe(false);
    } finally {
      rmTree(symlinkTarget);
    }
  });

  it('aborts when the target OmniWeave directory changes after locking', async () => {
    const symlinkTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-snapshot-race-target-'));
    const targetIndexDir = path.join(targetRoot, '.omniweave');
    const originalWithLockAsync = FileLock.prototype.withLockAsync;
    let replaced = false;
    FileLock.prototype.withLockAsync = async function patchedWithLockAsync<T>(fn: () => Promise<T>): Promise<T> {
      return await originalWithLockAsync.call(this, async () => {
        if (!replaced) {
          replaced = true;
          fs.rmSync(targetIndexDir, { recursive: true, force: true });
          fs.symlinkSync(symlinkTarget, targetIndexDir, 'dir');
        }
        return await fn();
      });
    };

    try {
      await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/changed during snapshot import/);
      expect(fs.existsSync(path.join(symlinkTarget, SNAPSHOT_DATABASE_FILENAME))).toBe(false);
    } finally {
      FileLock.prototype.withLockAsync = originalWithLockAsync;
      rmTree(symlinkTarget);
      fs.rmSync(targetIndexDir, { recursive: true, force: true });
    }
  });

  it('does not replace an existing index unless force is explicit', async () => {
    await indexProject(targetRoot);

    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/already initialized/);
    await expect(importSnapshot(outputDir, targetRoot, { force: true })).resolves.toMatchObject({
      projectRoot: fs.realpathSync(targetRoot),
    });
  });

  it('refuses unsafe target roots unless explicitly allowed', async () => {
    await withFakeHome(targetRoot, async () => {
      await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/Refusing to import snapshot/);
      expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);

      await expect(importSnapshot(outputDir, targetRoot, { allowUnsafeRoot: true })).resolves.toMatchObject({
        projectRoot: fs.realpathSync(targetRoot),
      });
    });
  });

  it('verifies and imports through the built CLI JSON contract', () => {
    const verify = spawnSync(process.execPath, [
      BIN,
      'snapshot',
      'verify',
      outputDir,
      '--path',
      targetRoot,
      '--json',
    ], {
      cwd: targetRoot,
      encoding: 'utf-8',
      env: {
        ...process.env,
        OMNIWEAVE_NO_DAEMON: '1',
        OMNIWEAVE_NO_WATCH: '1',
      },
    });

    expect(verify.status).toBe(0);
    const verified = JSON.parse(verify.stdout) as VerifySnapshotResult;
    expect(verified.ok).toBe(true);
    expect(verified.staleness?.stale).toBe(false);

    const imported = spawnSync(process.execPath, [
      BIN,
      'snapshot',
      'import',
      outputDir,
      '--path',
      targetRoot,
      '--json',
    ], {
      cwd: targetRoot,
      encoding: 'utf-8',
      env: {
        ...process.env,
        OMNIWEAVE_NO_DAEMON: '1',
        OMNIWEAVE_NO_WATCH: '1',
      },
    });

    expect(imported.status).toBe(0);
    const result = JSON.parse(imported.stdout) as Awaited<ReturnType<typeof importSnapshot>>;
    expect(result.manifest.format).toBe(SNAPSHOT_FORMAT);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(true);
  });

  it('requires an explicit CLI flag for unsafe snapshot import roots', async () => {
    await withFakeHome(targetRoot, () => {
      const refused = spawnSync(process.execPath, [
        BIN,
        'snapshot',
        'import',
        outputDir,
        '--path',
        targetRoot,
        '--json',
      ], {
        cwd: targetRoot,
        encoding: 'utf-8',
        env: {
          ...process.env,
          OMNIWEAVE_NO_DAEMON: '1',
          OMNIWEAVE_NO_WATCH: '1',
        },
      });

      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain('Refusing to import snapshot');
      expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);

      const imported = spawnSync(process.execPath, [
        BIN,
        'snapshot',
        'import',
        outputDir,
        '--path',
        targetRoot,
        '--allow-unsafe-root',
        '--json',
      ], {
        cwd: targetRoot,
        encoding: 'utf-8',
        env: {
          ...process.env,
          OMNIWEAVE_NO_DAEMON: '1',
          OMNIWEAVE_NO_WATCH: '1',
        },
      });

      expect(imported.status).toBe(0);
      const result = JSON.parse(imported.stdout) as Awaited<ReturnType<typeof importSnapshot>>;
      expect(result.manifest.format).toBe(SNAPSHOT_FORMAT);
      expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(true);
    });
  });
});
