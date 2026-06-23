/**
 * SQLite backend reporting.
 *
 * node:sqlite (Node's built-in real SQLite) is the sole backend. Pin that
 * DatabaseConnection / OmniWeave report it and come up in WAL.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseConnection } from '../src/db';
import { OmniWeave } from '../src';

describe('DatabaseConnection — backend reporting', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-backend-'));
  });

  afterEach(() => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports the node-sqlite backend in WAL for an initialized DB', () => {
    const conn = DatabaseConnection.initialize(path.join(dir, 'test.db'));
    expect(conn.getBackend()).toBe('node-sqlite');
    expect(conn.getJournalMode()).toBe('wal');
    conn.close();
  });

  it('can open an existing DB read-only without allowing writes', () => {
    const dbPath = path.join(dir, 'readonly.db');
    const writable = DatabaseConnection.initialize(dbPath);
    writable.close();

    const readonly = DatabaseConnection.open(dbPath, { migrate: false, readOnly: true });
    try {
      expect(readonly.getBackend()).toBe('node-sqlite');
      expect(readonly.getSchemaVersion()?.version).toBeGreaterThan(0);
      expect(() => readonly.getDb().exec('CREATE TABLE should_fail(id INTEGER)')).toThrow(/readonly database/i);
    } finally {
      readonly.close();
    }

    const check = DatabaseConnection.open(dbPath, { migrate: false });
    try {
      expect(
        check.getDb()
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get('should_fail')
      ).toBeUndefined();
    } finally {
      check.close();
    }
  });

  it('OmniWeave.getBackend() delegates to the underlying DatabaseConnection', async () => {
    fs.writeFileSync(path.join(dir, 'x.ts'), `export function x(): void {}\n`);
    const cg = await OmniWeave.init(dir, { index: true });
    try {
      expect(cg.getBackend()).toBe('node-sqlite');
    } finally {
      cg.destroy();
    }
  });
});
