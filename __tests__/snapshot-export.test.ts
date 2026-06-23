import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import OmniWeave from '../src/index';
import {
  exportSnapshot,
  SNAPSHOT_DATABASE_FILENAME,
  SNAPSHOT_FORMAT,
  SNAPSHOT_FORMAT_VERSION,
  SNAPSHOT_MANIFEST_FILENAME,
  type SnapshotManifest,
} from '../src/snapshot';

const BIN = path.resolve(__dirname, '../dist/bin/omniweave.js');

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function rmTree(dir: string): void {
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

describe('snapshot export', () => {
  let projectRoot: string;
  let outputDir: string;

  beforeEach(async () => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-snapshot-project-'));
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-snapshot-out-'));
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'index.ts'),
      `export function entry(): string {\n  return helper();\n}\n\nfunction helper(): string {\n  return 'ok';\n}\n`
    );

    const cg = OmniWeave.initSync(projectRoot);
    await cg.indexAll();
    cg.destroy();
  });

  afterEach(() => {
    rmTree(projectRoot);
    rmTree(outputDir);
  });

  it('writes a schema-versioned manifest with hashed graph files', async () => {
    const result = await exportSnapshot(projectRoot, outputDir, {
      omniweaveVersion: '9.9.9-test',
    });

    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf-8')) as SnapshotManifest;
    const dbPath = path.join(outputDir, SNAPSHOT_DATABASE_FILENAME);

    expect(fs.existsSync(dbPath)).toBe(true);
    expect(manifest.format).toBe(SNAPSHOT_FORMAT);
    expect(manifest.formatVersion).toBe(SNAPSHOT_FORMAT_VERSION);
    expect(manifest.omniweaveVersion).toBe('9.9.9-test');
    expect(manifest.schemaVersion).toEqual(expect.any(Number));
    expect(manifest.sourceRoot.path).toBe(fs.realpathSync(projectRoot));
    expect(manifest.sourceRoot.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.sourceRoot.indexedFileCount).toBe(1);
    expect(manifest.sourceRoot.languages).toEqual(['typescript']);
    expect(manifest.graph.fileCount).toBe(1);
    expect(manifest.graph.nodeCount).toBeGreaterThan(0);
    expect(manifest.graph.edgeCount).toBeGreaterThan(0);
    expect(manifest.files.database.path).toBe(SNAPSHOT_DATABASE_FILENAME);
    expect(manifest.files.database.bytes).toBe(fs.statSync(dbPath).size);
    expect(manifest.files.database.sha256).toBe(sha256(dbPath));
  });

  it('refuses to overwrite an existing snapshot unless forced', async () => {
    await exportSnapshot(projectRoot, outputDir, { omniweaveVersion: '9.9.9-test' });
    const staleWal = path.join(outputDir, `${SNAPSHOT_DATABASE_FILENAME}-wal`);
    fs.writeFileSync(staleWal, 'stale wal bytes');

    await expect(exportSnapshot(projectRoot, outputDir, {
      omniweaveVersion: '9.9.9-test',
    })).rejects.toThrow(/already contains/);

    await expect(exportSnapshot(projectRoot, outputDir, {
      force: true,
      omniweaveVersion: '9.9.9-test',
    })).resolves.toMatchObject({
      manifestPath: path.join(outputDir, SNAPSHOT_MANIFEST_FILENAME),
    });
    expect(fs.existsSync(staleWal)).toBe(false);
  });

  it('exports through the built CLI without changing the default MCP surface', () => {
    const cliOut = path.join(outputDir, 'cli');
    const result = spawnSync(process.execPath, [
      BIN,
      'snapshot',
      'export',
      cliOut,
      '--path',
      projectRoot,
      '--json',
    ], {
      cwd: projectRoot,
      encoding: 'utf-8',
      env: {
        ...process.env,
        OMNIWEAVE_NO_DAEMON: '1',
        OMNIWEAVE_NO_WATCH: '1',
      },
    });

    expect(result.status).toBe(0);
    const manifest = JSON.parse(result.stdout) as SnapshotManifest;
    expect(manifest.format).toBe(SNAPSHOT_FORMAT);
    expect(manifest.files.database.sha256).toBe(sha256(path.join(cliOut, SNAPSHOT_DATABASE_FILENAME)));
  });
});
