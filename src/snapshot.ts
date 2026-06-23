import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createDirectory, getOmniWeaveDir, isInitialized, validateDirectory } from './directory';
import { DatabaseConnection, getDatabasePath } from './db';
import { CURRENT_SCHEMA_VERSION } from './db/migrations';
import { QueryBuilder } from './db/queries';
import { FileLock, validatePathWithinRoot } from './utils';
import type { FileRecord, GraphStats, SchemaVersion } from './types';

export const SNAPSHOT_FORMAT = 'omniweave-snapshot';
export const SNAPSHOT_FORMAT_VERSION = 1;
export const SNAPSHOT_MANIFEST_FILENAME = 'omniweave-snapshot.json';
export const SNAPSHOT_DATABASE_FILENAME = 'omniweave.db';

export interface SnapshotManifest {
  format: typeof SNAPSHOT_FORMAT;
  formatVersion: typeof SNAPSHOT_FORMAT_VERSION;
  omniweaveVersion: string;
  createdAt: string;
  schemaVersion: number | null;
  sourceRoot: {
    path: string;
    fingerprint: string;
    indexedFileCount: number;
    languages: string[];
  };
  graph: {
    nodeCount: number;
    edgeCount: number;
    fileCount: number;
    nodesByKind: GraphStats['nodesByKind'];
    edgesByKind: GraphStats['edgesByKind'];
    filesByLanguage: GraphStats['filesByLanguage'];
  };
  files: {
    database: SnapshotFileEntry;
    wal?: SnapshotFileEntry;
    shm?: SnapshotFileEntry;
  };
}

export interface SnapshotFileEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ExportSnapshotOptions {
  force?: boolean;
  omniweaveVersion: string;
}

export interface ExportSnapshotResult {
  directory: string;
  manifestPath: string;
  databasePath: string;
  manifest: SnapshotManifest;
}

export interface VerifySnapshotOptions {
  projectRoot?: string;
}

export interface SnapshotStaleness {
  checked: boolean;
  stale: boolean;
  indexedFileCount: number;
  changedFiles: string[];
  missingFiles: string[];
  unreadableFiles: string[];
  unsafeFiles: string[];
}

export interface VerifySnapshotResult {
  directory: string;
  manifestPath: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest?: SnapshotManifest;
  staleness?: SnapshotStaleness;
}

export interface ImportSnapshotOptions {
  force?: boolean;
  allowStale?: boolean;
}

export interface ImportSnapshotResult {
  directory: string;
  projectRoot: string;
  manifestPath: string;
  databasePath: string;
  manifest: SnapshotManifest;
  warnings: string[];
  staleness: SnapshotStaleness | null;
}

export async function exportSnapshot(
  projectRoot: string,
  outputDir: string,
  options: ExportSnapshotOptions,
): Promise<ExportSnapshotResult> {
  const root = resolveExistingDirectory(projectRoot, 'project root');
  if (!isInitialized(root)) {
    throw new Error(`OmniWeave not initialized in ${root}`);
  }
  const validation = validateDirectory(root);
  if (!validation.valid) {
    throw new Error(`Invalid OmniWeave directory: ${validation.errors.join(', ')}`);
  }

  const outDir = path.resolve(outputDir);
  prepareOutputDirectory(outDir, options.force === true);

  const dbSourcePath = getDatabasePath(root);
  const dbTargetPath = path.join(outDir, SNAPSHOT_DATABASE_FILENAME);
  const manifestPath = path.join(outDir, SNAPSHOT_MANIFEST_FILENAME);
  const lock = new FileLock(path.join(getOmniWeaveDir(root), 'omniweave.lock'));

  return await lock.withLockAsync(async () => {
    const conn = DatabaseConnection.open(dbSourcePath);
    let stats: GraphStats;
    let schema: SchemaVersion | null;
    let files: FileRecord[];
    try {
      conn.getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const queries = new QueryBuilder(conn.getDb());
      stats = queries.getStats();
      stats.dbSizeBytes = conn.getSize();
      schema = conn.getSchemaVersion();
      files = queries.getAllFiles();
    } finally {
      conn.close();
    }

    fs.copyFileSync(dbSourcePath, dbTargetPath);
    const copiedFiles: SnapshotManifest['files'] = {
      database: await snapshotFileEntry(dbTargetPath, SNAPSHOT_DATABASE_FILENAME),
    };

    const walSourcePath = `${dbSourcePath}-wal`;
    if (fileHasBytes(walSourcePath)) {
      const walTargetPath = `${dbTargetPath}-wal`;
      fs.copyFileSync(walSourcePath, walTargetPath);
      copiedFiles.wal = await snapshotFileEntry(walTargetPath, `${SNAPSHOT_DATABASE_FILENAME}-wal`);
    }

    const shmSourcePath = `${dbSourcePath}-shm`;
    if (fileHasBytes(shmSourcePath)) {
      const shmTargetPath = `${dbTargetPath}-shm`;
      fs.copyFileSync(shmSourcePath, shmTargetPath);
      copiedFiles.shm = await snapshotFileEntry(shmTargetPath, `${SNAPSHOT_DATABASE_FILENAME}-shm`);
    }

    const manifest: SnapshotManifest = {
      format: SNAPSHOT_FORMAT,
      formatVersion: SNAPSHOT_FORMAT_VERSION,
      omniweaveVersion: options.omniweaveVersion,
      createdAt: new Date().toISOString(),
      schemaVersion: schema?.version ?? null,
      sourceRoot: {
        path: root,
        fingerprint: fingerprintIndexedFiles(files),
        indexedFileCount: files.length,
        languages: Object.entries(stats.filesByLanguage)
          .filter(([, count]) => count > 0)
          .map(([language]) => language)
          .sort(),
      },
      graph: {
        nodeCount: stats.nodeCount,
        edgeCount: stats.edgeCount,
        fileCount: stats.fileCount,
        nodesByKind: stats.nodesByKind,
        edgesByKind: stats.edgesByKind,
        filesByLanguage: stats.filesByLanguage,
      },
      files: copiedFiles,
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

    return {
      directory: outDir,
      manifestPath,
      databasePath: dbTargetPath,
      manifest,
    };
  });
}

export function readSnapshotManifest(snapshotDir: string): SnapshotManifest {
  const dir = resolveExistingDirectory(snapshotDir, 'snapshot directory');
  const manifestPath = path.join(dir, SNAPSHOT_MANIFEST_FILENAME);
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  return JSON.parse(raw) as SnapshotManifest;
}

export async function verifySnapshot(
  snapshotDir: string,
  options: VerifySnapshotOptions = {},
): Promise<VerifySnapshotResult> {
  const directory = resolveExistingDirectory(snapshotDir, 'snapshot directory');
  const manifestPath = path.join(directory, SNAPSHOT_MANIFEST_FILENAME);
  const errors: string[] = [];
  const warnings: string[] = [];

  const manifest = parseSnapshotManifest(manifestPath, errors);
  if (manifest) {
    await validateSnapshotManifest(directory, manifest, errors, warnings);
  }

  let staleness: SnapshotStaleness | undefined;
  if (manifest && errors.length === 0 && options.projectRoot) {
    const root = resolveExistingDirectory(options.projectRoot, 'project root');
    staleness = await withTemporarySnapshotDatabase(directory, manifest, async (dbPath) =>
      computeSnapshotStaleness(root, dbPath)
    );
    if (staleness.unsafeFiles.length > 0) {
      errors.push(
        `Snapshot database contains indexed paths outside the target root: ${summarizePaths(staleness.unsafeFiles)}`
      );
    }
    if (staleness.stale) {
      warnings.push(describeStaleness(staleness));
    }
  }

  return {
    directory,
    manifestPath,
    ok: errors.length === 0,
    errors,
    warnings,
    manifest,
    staleness,
  };
}

export async function importSnapshot(
  snapshotDir: string,
  projectRoot: string,
  options: ImportSnapshotOptions = {},
): Promise<ImportSnapshotResult> {
  const root = resolveExistingDirectory(projectRoot, 'project root');
  const verification = await verifySnapshot(snapshotDir, { projectRoot: root });
  if (!verification.ok || !verification.manifest) {
    throw new Error(`Invalid snapshot: ${summarizeMessages(verification.errors)}`);
  }

  const staleness = verification.staleness ?? null;
  if (staleness?.stale && options.allowStale !== true) {
    throw new Error(
      `${describeStaleness(staleness)} Re-run \`omniweave init -i\` for a fresh local graph, or pass --allow-stale to import this snapshot for inspection.`
    );
  }

  if (isInitialized(root) && options.force !== true) {
    throw new Error(`OmniWeave already initialized in ${root}; pass --force to replace known database files`);
  }

  if (!isInitialized(root)) {
    createDirectory(root);
  }

  const validation = validateDirectory(root);
  if (!validation.valid) {
    throw new Error(`Invalid OmniWeave directory: ${validation.errors.join(', ')}`);
  }

  const targetDir = getOmniWeaveDir(root);
  const lock = new FileLock(path.join(targetDir, 'omniweave.lock'));

  return await lock.withLockAsync(async () => {
    if (isInitialized(root) && options.force !== true) {
      throw new Error(`OmniWeave already initialized in ${root}; pass --force to replace known database files`);
    }

    installSnapshotArtifacts(verification.directory, targetDir, verification.manifest!);

    const databasePath = getDatabasePath(root);
    return {
      directory: verification.directory,
      projectRoot: root,
      manifestPath: verification.manifestPath,
      databasePath,
      manifest: verification.manifest!,
      warnings: verification.warnings,
      staleness,
    };
  });
}

function resolveExistingDirectory(dir: string, label: string): string {
  const resolved = path.resolve(dir);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`${label} does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${resolved}`);
  }
  return fs.realpathSync(resolved);
}

function prepareOutputDirectory(outputDir: string, force: boolean): void {
  if (fs.existsSync(outputDir) && !fs.statSync(outputDir).isDirectory()) {
    throw new Error(`Snapshot output path is not a directory: ${outputDir}`);
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const protectedFiles = [
    SNAPSHOT_MANIFEST_FILENAME,
    SNAPSHOT_DATABASE_FILENAME,
    `${SNAPSHOT_DATABASE_FILENAME}-wal`,
    `${SNAPSHOT_DATABASE_FILENAME}-shm`,
  ].map((name) => path.join(outputDir, name));

  const existing = protectedFiles.filter((file) => fs.existsSync(file));
  if (existing.length > 0 && !force) {
    throw new Error(`Snapshot output already contains ${path.basename(existing[0]!)}; pass --force to overwrite snapshot files`);
  }
  if (force) {
    for (const file of existing) fs.rmSync(file, { force: true });
  }
}

function parseSnapshotManifest(manifestPath: string, errors: string[]): SnapshotManifest | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8');
  } catch {
    errors.push(`Snapshot manifest not found: ${manifestPath}`);
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    errors.push(`Snapshot manifest is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }

  if (!isRecord(parsed)) {
    errors.push('Snapshot manifest must be a JSON object');
    return undefined;
  }
  return parsed as unknown as SnapshotManifest;
}

async function validateSnapshotManifest(
  snapshotDir: string,
  manifest: SnapshotManifest,
  errors: string[],
  warnings: string[],
): Promise<void> {
  if (manifest.format !== SNAPSHOT_FORMAT) {
    errors.push(`Unsupported snapshot format: ${String(manifest.format)}`);
  }
  if (manifest.formatVersion !== SNAPSHOT_FORMAT_VERSION) {
    errors.push(`Unsupported snapshot format version: ${String(manifest.formatVersion)}`);
  }
  if (typeof manifest.schemaVersion === 'number' && manifest.schemaVersion > CURRENT_SCHEMA_VERSION) {
    errors.push(
      `Snapshot schema version ${manifest.schemaVersion} is newer than this OmniWeave supports (${CURRENT_SCHEMA_VERSION})`
    );
  }
  if (!isRecord((manifest as unknown as Record<string, unknown>).files)) {
    errors.push('Snapshot manifest files must be an object');
    return;
  }

  await validateSnapshotFileEntry(snapshotDir, manifest.files.database, SNAPSHOT_DATABASE_FILENAME, true, errors);
  await validateSnapshotFileEntry(snapshotDir, manifest.files.wal, `${SNAPSHOT_DATABASE_FILENAME}-wal`, false, errors);
  await validateSnapshotFileEntry(snapshotDir, manifest.files.shm, `${SNAPSHOT_DATABASE_FILENAME}-shm`, false, errors);

  warnUnlistedArtifact(snapshotDir, manifest.files.wal, `${SNAPSHOT_DATABASE_FILENAME}-wal`, warnings);
  warnUnlistedArtifact(snapshotDir, manifest.files.shm, `${SNAPSHOT_DATABASE_FILENAME}-shm`, warnings);
}

async function validateSnapshotFileEntry(
  snapshotDir: string,
  entry: SnapshotFileEntry | undefined,
  expectedPath: string,
  required: boolean,
  errors: string[],
): Promise<void> {
  if (!entry) {
    if (required) errors.push(`Snapshot manifest is missing ${expectedPath}`);
    return;
  }
  if (!isRecord(entry)) {
    errors.push(`Snapshot manifest entry for ${expectedPath} must be an object`);
    return;
  }
  if (entry.path !== expectedPath) {
    errors.push(`Snapshot file entry for ${expectedPath} must use path "${expectedPath}"`);
    return;
  }
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
    errors.push(`Snapshot file entry for ${expectedPath} has invalid byte size`);
  }
  if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    errors.push(`Snapshot file entry for ${expectedPath} has invalid sha256`);
  }

  const artifactPath = path.join(snapshotDir, expectedPath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(artifactPath);
  } catch {
    errors.push(`Snapshot artifact not found: ${expectedPath}`);
    return;
  }
  if (!stat.isFile()) {
    errors.push(`Snapshot artifact is not a file: ${expectedPath}`);
    return;
  }
  if (stat.size !== entry.bytes) {
    errors.push(`Snapshot artifact size mismatch for ${expectedPath}: expected ${entry.bytes}, got ${stat.size}`);
  }
  const actualHash = await sha256File(artifactPath);
  if (actualHash !== entry.sha256) {
    errors.push(`Snapshot artifact hash mismatch for ${expectedPath}`);
  }
}

function warnUnlistedArtifact(
  snapshotDir: string,
  entry: SnapshotFileEntry | undefined,
  expectedPath: string,
  warnings: string[],
): void {
  if (!entry && fileHasBytes(path.join(snapshotDir, expectedPath))) {
    warnings.push(`${expectedPath} is present but not listed in the manifest; it will not be imported`);
  }
}

async function withTemporarySnapshotDatabase<T>(
  snapshotDir: string,
  manifest: SnapshotManifest,
  fn: (dbPath: string) => Promise<T>,
): Promise<T> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-snapshot-verify-'));
  try {
    copySnapshotArtifacts(snapshotDir, tempDir, manifest);
    return await fn(path.join(tempDir, SNAPSHOT_DATABASE_FILENAME));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function computeSnapshotStaleness(projectRoot: string, dbPath: string): Promise<SnapshotStaleness> {
  const conn = DatabaseConnection.open(dbPath);
  let files: FileRecord[];
  try {
    files = new QueryBuilder(conn.getDb()).getAllFiles();
  } finally {
    conn.close();
  }

  const changedFiles: string[] = [];
  const missingFiles: string[] = [];
  const unreadableFiles: string[] = [];
  const unsafeFiles: string[] = [];

  for (const file of files) {
    const fullPath = validatePathWithinRoot(projectRoot, file.path, { allowSymlinkEscape: true });
    if (!fullPath) {
      unsafeFiles.push(file.path);
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        missingFiles.push(file.path);
      } else {
        unreadableFiles.push(file.path);
      }
      continue;
    }

    if (hashContent(content) !== file.contentHash) {
      changedFiles.push(file.path);
    }
  }

  const stale =
    changedFiles.length > 0 ||
    missingFiles.length > 0 ||
    unreadableFiles.length > 0 ||
    unsafeFiles.length > 0;

  return {
    checked: true,
    stale,
    indexedFileCount: files.length,
    changedFiles,
    missingFiles,
    unreadableFiles,
    unsafeFiles,
  };
}

function copySnapshotArtifacts(snapshotDir: string, targetDir: string, manifest: SnapshotManifest): void {
  fs.mkdirSync(targetDir, { recursive: true });
  copySnapshotArtifact(snapshotDir, targetDir, manifest.files.database);
  if (manifest.files.wal) copySnapshotArtifact(snapshotDir, targetDir, manifest.files.wal);
  if (manifest.files.shm) copySnapshotArtifact(snapshotDir, targetDir, manifest.files.shm);
}

function copySnapshotArtifact(snapshotDir: string, targetDir: string, entry: SnapshotFileEntry): void {
  fs.copyFileSync(path.join(snapshotDir, entry.path), path.join(targetDir, entry.path));
}

function installSnapshotArtifacts(snapshotDir: string, targetDir: string, manifest: SnapshotManifest): void {
  const stagingDir = fs.mkdtempSync(path.join(targetDir, '.snapshot-import-stage-'));
  const backupDir = fs.mkdtempSync(path.join(targetDir, '.snapshot-import-backup-'));
  try {
    copySnapshotArtifacts(snapshotDir, stagingDir, manifest);
    moveKnownGraphFiles(targetDir, backupDir);
    moveSnapshotArtifacts(stagingDir, targetDir, manifest);
  } catch (err) {
    removeKnownGraphFiles(targetDir);
    restoreKnownGraphFiles(backupDir, targetDir);
    throw err;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

function moveSnapshotArtifacts(stagingDir: string, targetDir: string, manifest: SnapshotManifest): void {
  moveSnapshotArtifact(stagingDir, targetDir, manifest.files.database);
  if (manifest.files.wal) moveSnapshotArtifact(stagingDir, targetDir, manifest.files.wal);
  if (manifest.files.shm) moveSnapshotArtifact(stagingDir, targetDir, manifest.files.shm);
}

function moveSnapshotArtifact(stagingDir: string, targetDir: string, entry: SnapshotFileEntry): void {
  fs.renameSync(path.join(stagingDir, entry.path), path.join(targetDir, entry.path));
}

function moveKnownGraphFiles(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const name of knownGraphFileNames()) {
    const source = path.join(sourceDir, name);
    if (fs.existsSync(source)) {
      fs.renameSync(source, path.join(targetDir, name));
    }
  }
}

function restoreKnownGraphFiles(backupDir: string, targetDir: string): void {
  for (const name of knownGraphFileNames()) {
    const backup = path.join(backupDir, name);
    if (fs.existsSync(backup)) {
      fs.renameSync(backup, path.join(targetDir, name));
    }
  }
}

function removeKnownGraphFiles(targetDir: string): void {
  for (const name of knownGraphFileNames()) {
    fs.rmSync(path.join(targetDir, name), { force: true });
  }
}

function knownGraphFileNames(): string[] {
  return [
    SNAPSHOT_DATABASE_FILENAME,
    `${SNAPSHOT_DATABASE_FILENAME}-wal`,
    `${SNAPSHOT_DATABASE_FILENAME}-shm`,
  ];
}

function describeStaleness(staleness: SnapshotStaleness): string {
  const parts: string[] = [];
  if (staleness.changedFiles.length > 0) parts.push(`${staleness.changedFiles.length} changed`);
  if (staleness.missingFiles.length > 0) parts.push(`${staleness.missingFiles.length} missing`);
  if (staleness.unreadableFiles.length > 0) parts.push(`${staleness.unreadableFiles.length} unreadable`);
  if (staleness.unsafeFiles.length > 0) parts.push(`${staleness.unsafeFiles.length} unsafe`);
  return `Snapshot is stale for the target project (${parts.join(', ')} indexed files).`;
}

function summarizeMessages(messages: string[]): string {
  if (messages.length === 0) return 'unknown validation error';
  const shown = messages.slice(0, 3).join('; ');
  return messages.length > 3 ? `${shown}; ...` : shown;
}

function summarizePaths(paths: string[]): string {
  const shown = paths.slice(0, 5).join(', ');
  return paths.length > 5 ? `${shown}, ...` : shown;
}

function fingerprintIndexedFiles(files: FileRecord[]): string {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(file.contentHash);
    hash.update('\0');
    hash.update(file.language);
    hash.update('\0');
    hash.update(String(file.size));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function snapshotFileEntry(filePath: string, relativePath: string): Promise<SnapshotFileEntry> {
  return {
    path: relativePath,
    bytes: fs.statSync(filePath).size,
    sha256: await sha256File(filePath),
  };
}

function fileHasBytes(filePath: string): boolean {
  try {
    return fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
