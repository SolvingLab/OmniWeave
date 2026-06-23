import * as fs from 'fs';
import * as path from 'path';
import type { Language } from './types';
import { isLanguageSupported } from './extraction/grammars';
import { logWarn } from './errors';

export const PROJECT_CONFIG_FILENAME = 'omniweave.json';

export interface ProjectConfig {
  extensions?: Record<string, string>;
}

interface CacheEntry {
  mtimeMs: number;
  overrides: Record<string, Language>;
}

const cacheMeta = new Map<string, CacheEntry>();
const EMPTY: Record<string, Language> = Object.freeze({});

function normalizeExtKey(raw: string): string | null {
  let ext = raw.trim().toLowerCase();
  if (!ext) return null;
  if (!ext.startsWith('.')) ext = `.${ext}`;
  const body = ext.slice(1);
  if (!body || body.includes('.') || body.includes('/') || body.includes('\\')) return null;
  return ext;
}

function parseExtensionOverrides(file: string): Record<string, Language> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return EMPTY;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logWarn(`Ignoring ${PROJECT_CONFIG_FILENAME}: not valid JSON`, {
      file,
      error: error instanceof Error ? error.message : String(error),
    });
    return EMPTY;
  }

  if (!parsed || typeof parsed !== 'object') return EMPTY;
  const exts = (parsed as ProjectConfig).extensions;
  if (!exts || typeof exts !== 'object' || Array.isArray(exts)) return EMPTY;

  const out: Record<string, Language> = {};
  for (const [rawKey, rawVal] of Object.entries(exts)) {
    const key = normalizeExtKey(rawKey);
    if (!key) {
      logWarn(`Ignoring extension mapping in ${PROJECT_CONFIG_FILENAME}: "${rawKey}" is not a valid file extension`, { file });
      continue;
    }
    if (typeof rawVal !== 'string' || !isLanguageSupported(rawVal as Language)) {
      logWarn(`Ignoring extension "${rawKey}" in ${PROJECT_CONFIG_FILENAME}: "${String(rawVal)}" is not a supported language`, { file });
      continue;
    }
    out[key] = rawVal as Language;
  }

  return Object.keys(out).length > 0 ? out : EMPTY;
}

export function loadExtensionOverrides(rootDir: string): Record<string, Language> {
  const file = path.join(rootDir, PROJECT_CONFIG_FILENAME);
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    cacheMeta.delete(rootDir);
    return EMPTY;
  }

  const cached = cacheMeta.get(rootDir);
  if (cached && cached.mtimeMs === mtimeMs) return cached.overrides;

  const overrides = parseExtensionOverrides(file);
  cacheMeta.set(rootDir, { mtimeMs, overrides });
  return overrides;
}

export function clearProjectConfigCache(): void {
  cacheMeta.clear();
}
