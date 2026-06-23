import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import OmniWeave from '../src/index';
import { DatabaseConnection, getDatabasePath } from '../src/db';
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
    expect(verification.errors.join('\n')).toContain('outside the target root');
    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/Invalid snapshot/);
    expect(fs.existsSync(getDatabasePath(targetRoot))).toBe(false);
  });

  it('does not replace an existing index unless force is explicit', async () => {
    await indexProject(targetRoot);

    await expect(importSnapshot(outputDir, targetRoot)).rejects.toThrow(/already initialized/);
    await expect(importSnapshot(outputDir, targetRoot, { force: true })).resolves.toMatchObject({
      projectRoot: fs.realpathSync(targetRoot),
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
});
