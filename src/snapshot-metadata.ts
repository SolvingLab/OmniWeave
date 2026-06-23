export const SNAPSHOT_IMPORT_METADATA_KEYS = {
  imported: 'snapshot.imported',
  importedAt: 'snapshot.imported_at',
  manifestHash: 'snapshot.manifest_hash',
  sourceFingerprint: 'snapshot.source_fingerprint',
  sourceOmniWeaveVersion: 'snapshot.source_omniweave_version',
  allowStale: 'snapshot.allow_stale',
  staleness: 'snapshot.staleness',
} as const;

export interface SnapshotImportInfo {
  importedAt: string | null;
  manifestHash: string | null;
  sourceFingerprint: string | null;
  sourceOmniWeaveVersion: string | null;
  allowStale: boolean;
  staleness: {
    stale: boolean;
    changedFiles: number;
    missingFiles: number;
    unreadableFiles: number;
    unsafeFiles: number;
  } | null;
}

export function readSnapshotImportInfo(read: (key: string) => string | null): SnapshotImportInfo | null {
  if (read(SNAPSHOT_IMPORT_METADATA_KEYS.imported) !== 'true') return null;

  return {
    importedAt: read(SNAPSHOT_IMPORT_METADATA_KEYS.importedAt),
    manifestHash: read(SNAPSHOT_IMPORT_METADATA_KEYS.manifestHash),
    sourceFingerprint: read(SNAPSHOT_IMPORT_METADATA_KEYS.sourceFingerprint),
    sourceOmniWeaveVersion: read(SNAPSHOT_IMPORT_METADATA_KEYS.sourceOmniWeaveVersion),
    allowStale: read(SNAPSHOT_IMPORT_METADATA_KEYS.allowStale) === 'true',
    staleness: parseStaleness(read(SNAPSHOT_IMPORT_METADATA_KEYS.staleness)),
  };
}

function parseStaleness(raw: string | null): SnapshotImportInfo['staleness'] {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      stale: parsed.stale === true,
      changedFiles: numberValue(parsed.changedFiles),
      missingFiles: numberValue(parsed.missingFiles),
      unreadableFiles: numberValue(parsed.unreadableFiles),
      unsafeFiles: numberValue(parsed.unsafeFiles),
    };
  } catch {
    return null;
  }
}

function numberValue(value: unknown): number {
  return Number.isSafeInteger(value) && typeof value === 'number' ? value : 0;
}
