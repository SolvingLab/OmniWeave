import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createDirectory, getOmniWeaveDir, isInitialized, unsafeIndexRootReason, validateDirectory } from './directory';
import { DatabaseConnection, getDatabasePath, type SqliteDatabase } from './db';
import { CURRENT_SCHEMA_VERSION } from './db/migrations';
import { QueryBuilder } from './db/queries';
import { detectLanguage, scanDirectory } from './extraction';
import { loadExtensionOverrides } from './project-config';
import { SNAPSHOT_IMPORT_METADATA_KEYS } from './snapshot-metadata';
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
  targetChecked: boolean;
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest?: SnapshotManifest;
  staleness?: SnapshotStaleness;
}

export interface ImportSnapshotOptions {
  force?: boolean;
  allowStale?: boolean;
  allowUnsafeRoot?: boolean;
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

interface StagedVerifySnapshotResult extends VerifySnapshotResult {
  stagingDir?: string;
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
  assertSnapshotOutputOutsideIndex(outDir, root);
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
  const verification = await verifySnapshotWithStaging(snapshotDir, options);
  try {
    return {
      directory: verification.directory,
      manifestPath: verification.manifestPath,
      targetChecked: verification.targetChecked,
      ok: verification.ok,
      errors: verification.errors,
      warnings: verification.warnings,
      manifest: verification.manifest,
      staleness: verification.staleness,
    };
  } finally {
    removeStagingDirectory(verification.stagingDir);
  }
}

async function verifySnapshotWithStaging(
  snapshotDir: string,
  options: VerifySnapshotOptions = {},
): Promise<StagedVerifySnapshotResult> {
  const directory = resolveExistingDirectory(snapshotDir, 'snapshot directory');
  const manifestPath = path.join(directory, SNAPSHOT_MANIFEST_FILENAME);
  const errors: string[] = [];
  const warnings: string[] = [];
  const targetRoot = options.projectRoot
    ? resolveExistingDirectory(options.projectRoot, 'project root')
    : undefined;
  const targetChecked = targetRoot !== undefined;

  const manifest = parseSnapshotManifest(manifestPath, errors);
  let stagingDir: string | undefined;
  if (manifest) {
    const canStage = validateSnapshotManifest(manifest, errors);
    if (canStage) {
      stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-snapshot-stage-'));
      try {
        stageSnapshotArtifacts(directory, stagingDir, manifest, errors, warnings);
        if (errors.length === 0) {
          await validateStagedSnapshotArtifacts(stagingDir, manifest, errors);
        }
        if (errors.length === 0) {
          validateStagedSnapshotDatabase(path.join(stagingDir, SNAPSHOT_DATABASE_FILENAME), manifest, errors, targetRoot);
        }
        if (errors.length === 0) {
          await validateStagedSnapshotArtifacts(stagingDir, manifest, errors);
        }
      } catch (err) {
        errors.push(`Snapshot artifact staging failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  let staleness: SnapshotStaleness | undefined;
  if (manifest && stagingDir && errors.length === 0 && targetRoot) {
    staleness = await computeSnapshotStaleness(targetRoot, path.join(stagingDir, SNAPSHOT_DATABASE_FILENAME));
    if (staleness.unsafeFiles.length > 0) {
      errors.push(
        `Snapshot database contains indexed paths outside the target root: ${summarizePaths(staleness.unsafeFiles)}`
      );
    }
    if (staleness.stale) {
      warnings.push(describeStaleness(staleness));
    }
  }
  if (manifest && stagingDir && errors.length === 0) {
    await validateStagedSnapshotArtifacts(stagingDir, manifest, errors);
  }

  return {
    directory,
    manifestPath,
    targetChecked,
    ok: errors.length === 0,
    errors,
    warnings,
    manifest,
    staleness,
    stagingDir,
  };
}

export async function importSnapshot(
  snapshotDir: string,
  projectRoot: string,
  options: ImportSnapshotOptions = {},
): Promise<ImportSnapshotResult> {
  const root = resolveExistingDirectory(projectRoot, 'project root');
  const unsafe = unsafeIndexRootReason(root);
  if (unsafe && options.allowUnsafeRoot !== true) {
    throw new Error(
      `Refusing to import snapshot into ${root} — it looks like ${unsafe}. ` +
      'Run this inside a specific project directory, or pass --allow-unsafe-root if you really mean to replace that .omniweave index.'
    );
  }
  const verification = await verifySnapshotWithStaging(snapshotDir, { projectRoot: root });
  try {
    if (!verification.ok || !verification.manifest || !verification.stagingDir) {
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
    const targetIdentity = snapshotDirectoryIdentity(targetDir);
    const lock = new FileLock(path.join(targetDir, 'omniweave.lock'));

    return await lock.withLockAsync(async () => {
      if (isInitialized(root) && options.force !== true) {
        throw new Error(`OmniWeave already initialized in ${root}; pass --force to replace known database files`);
      }
      assertSnapshotDirectoryIdentity(targetDir, targetIdentity);

      installSnapshotArtifacts(verification.stagingDir!, targetDir, verification.manifest!);

      const databasePath = getDatabasePath(root);
      await recordSnapshotImportMetadata(databasePath, verification.manifest!, verification.manifestPath, staleness, options);
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
  } finally {
    removeStagingDirectory(verification.stagingDir);
  }
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

function assertSnapshotOutputOutsideIndex(outputDir: string, projectRoot: string): void {
  const indexDir = path.resolve(getOmniWeaveDir(projectRoot));
  const indexReal = fs.existsSync(indexDir) ? fs.realpathSync(indexDir) : indexDir;
  const candidates = [path.resolve(outputDir), realpathForPossiblyMissingPath(outputDir)];
  if (fs.existsSync(outputDir)) candidates.push(fs.realpathSync(outputDir));

  if (candidates.some((candidate) => isSameOrChildPath(candidate, indexDir) || isSameOrChildPath(candidate, indexReal))) {
    throw new Error(`Snapshot output directory must be outside ${path.basename(indexDir)}: ${outputDir}`);
  }
}

function realpathForPossiblyMissingPath(targetPath: string): string {
  let current = path.resolve(targetPath);
  const missingParts: string[] = [];

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(targetPath);
    missingParts.unshift(path.basename(current));
    current = parent;
  }

  return path.join(fs.realpathSync(current), ...missingParts);
}

function isSameOrChildPath(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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

function validateSnapshotManifest(
  manifest: SnapshotManifest,
  errors: string[],
): boolean {
  const raw = manifest as unknown as Record<string, unknown>;
  if (manifest.format !== SNAPSHOT_FORMAT) {
    errors.push(`Unsupported snapshot format: ${String(manifest.format)}`);
  }
  if (manifest.formatVersion !== SNAPSHOT_FORMAT_VERSION) {
    errors.push(`Unsupported snapshot format version: ${String(manifest.formatVersion)}`);
  }
  if (
    manifest.schemaVersion !== null &&
    (!Number.isSafeInteger(manifest.schemaVersion) || manifest.schemaVersion < 0)
  ) {
    errors.push('Snapshot manifest schemaVersion must be a non-negative integer or null');
  } else if (typeof manifest.schemaVersion === 'number' && manifest.schemaVersion > CURRENT_SCHEMA_VERSION) {
      errors.push(
        `Snapshot schema version ${manifest.schemaVersion} is newer than this OmniWeave supports (${CURRENT_SCHEMA_VERSION})`
      );
  }
  if (!isRecord(raw.sourceRoot)) {
    errors.push('Snapshot manifest sourceRoot must be an object');
  }
  if (!isRecord(raw.graph)) {
    errors.push('Snapshot manifest graph must be an object');
  }
  if (!isRecord(raw.files)) {
    errors.push('Snapshot manifest files must be an object');
    return false;
  }

  return errors.length === 0;
}

function validateSnapshotFileEntryMetadata(
  entry: SnapshotFileEntry | undefined,
  expectedPath: string,
  required: boolean,
  errors: string[],
): SnapshotFileEntry | undefined {
  const errorCount = errors.length;
  if (!entry) {
    if (required) errors.push(`Snapshot manifest is missing ${expectedPath}`);
    return undefined;
  }
  if (!isRecord(entry)) {
    errors.push(`Snapshot manifest entry for ${expectedPath} must be an object`);
    return undefined;
  }
  if (entry.path !== expectedPath) {
    errors.push(`Snapshot file entry for ${expectedPath} must use path "${expectedPath}"`);
    return undefined;
  }
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
    errors.push(`Snapshot file entry for ${expectedPath} has invalid byte size`);
  }
  if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    errors.push(`Snapshot file entry for ${expectedPath} has invalid sha256`);
  }
  return errors.length === errorCount ? entry : undefined;
}

function stageSnapshotArtifacts(
  snapshotDir: string,
  stagingDir: string,
  manifest: SnapshotManifest,
  errors: string[],
  warnings: string[],
): void {
  fs.mkdirSync(stagingDir, { recursive: true });
  stageSnapshotArtifact(snapshotDir, stagingDir, manifest.files.database, SNAPSHOT_DATABASE_FILENAME, true, errors);
  stageSnapshotArtifact(snapshotDir, stagingDir, manifest.files.wal, `${SNAPSHOT_DATABASE_FILENAME}-wal`, false, errors);
  stageSnapshotArtifact(snapshotDir, stagingDir, manifest.files.shm, `${SNAPSHOT_DATABASE_FILENAME}-shm`, false, errors);

  warnUnlistedArtifact(snapshotDir, manifest.files.wal, `${SNAPSHOT_DATABASE_FILENAME}-wal`, warnings);
  warnUnlistedArtifact(snapshotDir, manifest.files.shm, `${SNAPSHOT_DATABASE_FILENAME}-shm`, warnings);
}

function stageSnapshotArtifact(
  snapshotDir: string,
  stagingDir: string,
  entry: SnapshotFileEntry | undefined,
  expectedPath: string,
  required: boolean,
  errors: string[],
): void {
  const validEntry = validateSnapshotFileEntryMetadata(entry, expectedPath, required, errors);
  if (!validEntry) return;

  const artifactPath = path.join(snapshotDir, expectedPath);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(artifactPath);
  } catch {
    errors.push(`Snapshot artifact not found: ${expectedPath}`);
    return;
  }
  if (stat.isSymbolicLink()) {
    errors.push(`Snapshot artifact must not be a symlink: ${expectedPath}`);
    return;
  }
  if (!stat.isFile()) {
    errors.push(`Snapshot artifact is not a file: ${expectedPath}`);
    return;
  }

  fs.copyFileSync(artifactPath, path.join(stagingDir, validEntry.path));
}

async function validateStagedSnapshotArtifacts(
  stagingDir: string,
  manifest: SnapshotManifest,
  errors: string[],
): Promise<void> {
  await validateStagedSnapshotFileEntry(stagingDir, manifest.files.database, SNAPSHOT_DATABASE_FILENAME, true, errors);
  await validateStagedSnapshotFileEntry(stagingDir, manifest.files.wal, `${SNAPSHOT_DATABASE_FILENAME}-wal`, false, errors);
  await validateStagedSnapshotFileEntry(stagingDir, manifest.files.shm, `${SNAPSHOT_DATABASE_FILENAME}-shm`, false, errors);
}

async function validateStagedSnapshotFileEntry(
  stagingDir: string,
  entry: SnapshotFileEntry | undefined,
  expectedPath: string,
  required: boolean,
  errors: string[],
): Promise<void> {
  const validEntry = validateSnapshotFileEntryMetadata(entry, expectedPath, required, errors);
  if (!validEntry) return;

  const artifactPath = path.join(stagingDir, validEntry.path);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(artifactPath);
  } catch {
    errors.push(`Staged snapshot artifact not found: ${expectedPath}`);
    return;
  }
  if (!stat.isFile()) {
    errors.push(`Staged snapshot artifact is not a file: ${expectedPath}`);
    return;
  }
  if (stat.size !== validEntry.bytes) {
    errors.push(`Snapshot artifact size mismatch for ${expectedPath}: expected ${validEntry.bytes}, got ${stat.size}`);
  }
  const actualHash = await sha256File(artifactPath);
  if (actualHash !== validEntry.sha256) {
    errors.push(`Snapshot artifact hash mismatch for ${expectedPath}`);
  }
}

function validateStagedSnapshotDatabase(
  databasePath: string,
  manifest: SnapshotManifest,
  errors: string[],
  targetRoot?: string,
): void {
  let conn: DatabaseConnection | undefined;
  try {
    conn = DatabaseConnection.open(databasePath, { migrate: false, readOnly: true });
    const actualSchemaVersion = conn.getSchemaVersion()?.version ?? null;
    if (actualSchemaVersion !== manifest.schemaVersion) {
      errors.push(
        `Snapshot database schema version ${formatSchemaVersion(actualSchemaVersion)} does not match manifest schemaVersion ${formatSchemaVersion(manifest.schemaVersion)}`
      );
      return;
    }
    validateSnapshotPathColumn(conn.getDb(), 'files', 'path', 'files.path', errors);
    validateSnapshotPathColumn(conn.getDb(), 'nodes', 'file_path', 'nodes.file_path', errors);
    validateSnapshotPathColumn(conn.getDb(), 'unresolved_refs', 'file_path', 'unresolved_refs.file_path', errors);
    validateSnapshotDatabasePragmas(conn.getDb(), errors);
    validateSnapshotIndexedPathMembership(conn.getDb(), errors);
    if (targetRoot) {
      validateSnapshotTargetImportPolicy(targetRoot, conn.getDb(), errors);
    }
    validateSnapshotManifestMatchesDatabase(conn.getDb(), manifest, errors);
  } catch (err) {
    errors.push(`Snapshot database validation failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    conn?.close();
  }
}

function validateSnapshotTargetImportPolicy(projectRoot: string, db: SqliteDatabase, errors: string[]): void {
  let importablePaths: Set<string>;
  try {
    importablePaths = new Set(scanDirectory(projectRoot));
  } catch (err) {
    errors.push(`Snapshot target import policy failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const files = new QueryBuilder(db).getAllFiles();
  const filesByPath = new Map(files.map((file) => [file.path, file.language]));
  const extensionOverrides = loadExtensionOverrides(projectRoot);
  const unimportable: string[] = [];
  const languageMismatches: string[] = [];

  for (const file of files) {
    if (!importablePaths.has(file.path)) {
      unimportable.push(file.path);
      continue;
    }
    const fullPath = validatePathWithinRoot(projectRoot, file.path);
    if (!fullPath) {
      unimportable.push(file.path);
      continue;
    }
    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      unimportable.push(file.path);
      continue;
    }
    const actualLanguage = detectLanguage(file.path, content, extensionOverrides);
    if (actualLanguage !== file.language) {
      languageMismatches.push(`${file.path} (snapshot ${file.language}, target ${actualLanguage})`);
    }
  }

  if (unimportable.length > 0) {
    errors.push(`Snapshot database contains files.path values the target indexer would not import: ${summarizePaths(unimportable)}`);
  }
  if (languageMismatches.length > 0) {
    errors.push(`Snapshot database contains files.language values that do not match the target indexer: ${summarizePaths(languageMismatches)}`);
  }

  validateSnapshotLanguageMembership(db, 'nodes', 'file_path', 'language', 'nodes.language', filesByPath, errors);
  validateSnapshotLanguageMembership(db, 'unresolved_refs', 'file_path', 'language', 'unresolved_refs.language', filesByPath, errors);
}

function validateSnapshotLanguageMembership(
  db: SqliteDatabase,
  table: string,
  pathColumn: string,
  languageColumn: string,
  label: string,
  filesByPath: Map<string, string>,
  errors: string[],
): void {
  let rows: Array<{ path: unknown; language: unknown }>;
  try {
    rows = db.prepare(`
      SELECT DISTINCT ${pathColumn} AS path, ${languageColumn} AS language
      FROM ${table}
      WHERE ${pathColumn} IS NOT NULL
        AND ${pathColumn} != ''
    `).all() as Array<{ path: unknown; language: unknown }>;
  } catch (err) {
    errors.push(`Snapshot database cannot validate ${label}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const mismatches = rows
    .filter((row) => typeof row.path === 'string')
    .filter((row) => filesByPath.get(row.path as string) !== row.language)
    .map((row) => `${displayPathValue(row.path)} (snapshot ${String(row.language)}, files ${String(filesByPath.get(row.path as string))})`);
  if (mismatches.length > 0) {
    errors.push(`Snapshot database contains ${label} values that do not match files.language: ${summarizePaths(mismatches)}`);
  }
}

function validateSnapshotPathColumn(
  db: SqliteDatabase,
  table: string,
  column: string,
  label: string,
  errors: string[],
): void {
  let rows: Array<{ value: unknown }>;
  try {
    rows = db.prepare(`SELECT DISTINCT ${column} AS value FROM ${table}`).all() as Array<{ value: unknown }>;
  } catch (err) {
    errors.push(`Snapshot database cannot read ${label}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const unsafeValues = rows
    .map((row) => row.value)
    .filter((value) => !isSafeSnapshotIndexedPath(value))
    .map(displayPathValue);
  if (unsafeValues.length > 0) {
    errors.push(`Snapshot database contains unsafe ${label} values: ${summarizePaths(unsafeValues)}`);
  }
}

function validateSnapshotDatabasePragmas(db: SqliteDatabase, errors: string[]): void {
  const integrityRows = db.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>;
  const integrityProblems = integrityRows
    .map((row) => String(Object.values(row)[0] ?? ''))
    .filter((value) => value && value !== 'ok');
  if (integrityProblems.length > 0) {
    errors.push(`Snapshot database failed integrity_check: ${summarizePaths(integrityProblems)}`);
  }

  const foreignKeyRows = db.prepare('PRAGMA foreign_key_check').all() as Array<Record<string, unknown>>;
  if (foreignKeyRows.length > 0) {
    errors.push(`Snapshot database failed foreign_key_check: ${foreignKeyRows.length} violation${foreignKeyRows.length === 1 ? '' : 's'}`);
  }
}

function validateSnapshotIndexedPathMembership(db: SqliteDatabase, errors: string[]): void {
  validateSnapshotPathMembership(db, 'nodes', 'file_path', 'nodes.file_path', errors);
  validateSnapshotPathMembership(db, 'unresolved_refs', 'file_path', 'unresolved_refs.file_path', errors);
}

function validateSnapshotPathMembership(
  db: SqliteDatabase,
  table: string,
  column: string,
  label: string,
  errors: string[],
): void {
  let rows: Array<{ value: unknown }>;
  try {
    rows = db.prepare(`
      SELECT DISTINCT ${table}.${column} AS value
      FROM ${table}
      LEFT JOIN files ON files.path = ${table}.${column}
      WHERE ${table}.${column} IS NOT NULL
        AND ${table}.${column} != ''
        AND files.path IS NULL
    `).all() as Array<{ value: unknown }>;
  } catch (err) {
    errors.push(`Snapshot database cannot validate ${label} membership: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (rows.length > 0) {
    errors.push(
      `Snapshot database contains ${label} values not present in files.path: ${summarizePaths(rows.map((row) => displayPathValue(row.value)))}`
    );
  }
}

function validateSnapshotManifestMatchesDatabase(
  db: SqliteDatabase,
  manifest: SnapshotManifest,
  errors: string[],
): void {
  const queries = new QueryBuilder(db);
  const stats = queries.getStats();
  const files = queries.getAllFiles();
  const expectedLanguages = Object.entries(stats.filesByLanguage)
    .filter(([, count]) => count > 0)
    .map(([language]) => language)
    .sort();

  validateSnapshotManifestValue('sourceRoot.fingerprint', manifest.sourceRoot.fingerprint, fingerprintIndexedFiles(files), errors);
  validateSnapshotManifestValue('sourceRoot.indexedFileCount', manifest.sourceRoot.indexedFileCount, files.length, errors);
  validateSnapshotManifestStringArray('sourceRoot.languages', manifest.sourceRoot.languages, expectedLanguages, errors);
  validateSnapshotManifestValue('graph.nodeCount', manifest.graph.nodeCount, stats.nodeCount, errors);
  validateSnapshotManifestValue('graph.edgeCount', manifest.graph.edgeCount, stats.edgeCount, errors);
  validateSnapshotManifestValue('graph.fileCount', manifest.graph.fileCount, stats.fileCount, errors);
  validateSnapshotManifestCountMap('graph.nodesByKind', manifest.graph.nodesByKind, stats.nodesByKind, errors);
  validateSnapshotManifestCountMap('graph.edgesByKind', manifest.graph.edgesByKind, stats.edgesByKind, errors);
  validateSnapshotManifestCountMap('graph.filesByLanguage', manifest.graph.filesByLanguage, stats.filesByLanguage, errors);
}

function validateSnapshotManifestValue(
  label: string,
  actual: unknown,
  expected: string | number,
  errors: string[],
): void {
  if (actual !== expected) {
    errors.push(`Snapshot manifest ${label} does not match database: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function validateSnapshotManifestStringArray(
  label: string,
  actual: unknown,
  expected: string[],
  errors: string[],
): void {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== 'string')) {
    errors.push(`Snapshot manifest ${label} must be an array of strings`);
    return;
  }
  const sorted = [...actual].sort();
  if (sorted.length !== expected.length || sorted.some((value, index) => value !== expected[index])) {
    errors.push(`Snapshot manifest ${label} does not match database`);
  }
}

function validateSnapshotManifestCountMap(
  label: string,
  actual: unknown,
  expected: Record<string, number>,
  errors: string[],
): void {
  if (!isRecord(actual)) {
    errors.push(`Snapshot manifest ${label} must be an object`);
    return;
  }
  const actualEntries = Object.entries(actual).sort(([a], [b]) => a.localeCompare(b));
  const expectedEntries = Object.entries(expected).sort(([a], [b]) => a.localeCompare(b));
  const same = actualEntries.length === expectedEntries.length &&
    actualEntries.every(([key, value], index) => {
      const expectedEntry = expectedEntries[index];
      return expectedEntry !== undefined && key === expectedEntry[0] && value === expectedEntry[1];
    });
  if (!same) {
    errors.push(`Snapshot manifest ${label} does not match database`);
  }
}

function isSafeSnapshotIndexedPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || value.includes('\\')) {
    return false;
  }
  if (path.isAbsolute(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    return false;
  }
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== '.' && normalized !== '..' && !normalized.startsWith('../');
}

function displayPathValue(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function formatSchemaVersion(version: number | null): string {
  return version === null ? 'null' : String(version);
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

async function computeSnapshotStaleness(projectRoot: string, dbPath: string): Promise<SnapshotStaleness> {
  const conn = DatabaseConnection.open(dbPath, { migrate: false, readOnly: true });
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
    const fullPath = validatePathWithinRoot(projectRoot, file.path);
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

function installSnapshotArtifacts(stagingDir: string, targetDir: string, manifest: SnapshotManifest): void {
  const backupDir = fs.mkdtempSync(path.join(targetDir, '.snapshot-import-backup-'));
  try {
    moveKnownGraphFiles(targetDir, backupDir);
    moveSnapshotArtifacts(stagingDir, targetDir, manifest);
  } catch (err) {
    removeKnownGraphFiles(targetDir);
    restoreKnownGraphFiles(backupDir, targetDir);
    throw err;
  } finally {
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

interface SnapshotDirectoryIdentity {
  realpath: string;
  dev: number;
  ino: number;
}

function snapshotDirectoryIdentity(targetDir: string): SnapshotDirectoryIdentity {
  const stat = fs.lstatSync(targetDir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Invalid OmniWeave directory: ${targetDir}`);
  }
  return {
    realpath: fs.realpathSync(targetDir),
    dev: stat.dev,
    ino: stat.ino,
  };
}

function assertSnapshotDirectoryIdentity(targetDir: string, expected: SnapshotDirectoryIdentity): void {
  const stat = fs.lstatSync(targetDir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`OmniWeave directory changed during snapshot import: ${targetDir}`);
  }
  const realpath = fs.realpathSync(targetDir);
  if (realpath !== expected.realpath || stat.dev !== expected.dev || stat.ino !== expected.ino) {
    throw new Error(`OmniWeave directory changed during snapshot import: ${targetDir}`);
  }
}

function removeStagingDirectory(stagingDir: string | undefined): void {
  if (stagingDir) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
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

async function recordSnapshotImportMetadata(
  databasePath: string,
  manifest: SnapshotManifest,
  manifestPath: string,
  staleness: SnapshotStaleness | null,
  options: ImportSnapshotOptions,
): Promise<void> {
  const manifestHash = await sha256File(manifestPath);
  const conn = DatabaseConnection.open(databasePath);
  try {
    const queries = new QueryBuilder(conn.getDb());
    queries.setMetadata(SNAPSHOT_IMPORT_METADATA_KEYS.imported, 'true');
    queries.setMetadata(SNAPSHOT_IMPORT_METADATA_KEYS.importedAt, new Date().toISOString());
    queries.setMetadata(SNAPSHOT_IMPORT_METADATA_KEYS.manifestHash, manifestHash);
    queries.setMetadata(SNAPSHOT_IMPORT_METADATA_KEYS.sourceFingerprint, manifest.sourceRoot.fingerprint);
    queries.setMetadata(SNAPSHOT_IMPORT_METADATA_KEYS.sourceOmniWeaveVersion, manifest.omniweaveVersion);
    queries.setMetadata(SNAPSHOT_IMPORT_METADATA_KEYS.allowStale, options.allowStale === true ? 'true' : 'false');
    queries.setMetadata(SNAPSHOT_IMPORT_METADATA_KEYS.staleness, JSON.stringify({
      stale: staleness?.stale === true,
      changedFiles: staleness?.changedFiles.length ?? 0,
      missingFiles: staleness?.missingFiles.length ?? 0,
      unreadableFiles: staleness?.unreadableFiles.length ?? 0,
      unsafeFiles: staleness?.unsafeFiles.length ?? 0,
    }));
  } finally {
    conn.close();
  }
}
