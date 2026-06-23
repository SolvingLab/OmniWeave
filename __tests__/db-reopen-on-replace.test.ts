import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseConnection } from '../src/db';
import { getOmniWeaveDir } from '../src/directory';
import OmniWeave from '../src/index';

const posixOnly = it.runIf(process.platform !== 'win32');
const windowsOnly = it.runIf(process.platform === 'win32');

describe('DatabaseConnection.isReplacedOnDisk', () => {
  let dir: string;
  let dbPath: string;
  let conn: DatabaseConnection;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-db-replace-'));
    dbPath = path.join(dir, 'omniweave.db');
    conn = DatabaseConnection.initialize(dbPath);
  });

  afterEach(() => {
    try {
      conn.close();
    } catch {
      // May already be closed by the test.
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is false for the file it opened', () => {
    expect(conn.isReplacedOnDisk()).toBe(false);
  });

  posixOnly('becomes true when a different inode lives at the same path', () => {
    fs.rmSync(dbPath);
    fs.writeFileSync(dbPath, 'new inode');
    expect(conn.isReplacedOnDisk()).toBe(true);
  });

  posixOnly('stays false while the file is absent', () => {
    fs.rmSync(dbPath);
    expect(conn.isReplacedOnDisk()).toBe(false);
  });

  windowsOnly('never fires on Windows', () => {
    expect(conn.isReplacedOnDisk()).toBe(false);
  });
});

describe('OmniWeave.reopenIfReplaced', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-reopen-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export function fooOld() { return 1; }\n');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  posixOnly('heals a held connection after the index is recreated at the same path', async () => {
    const server = OmniWeave.initSync(root);
    await server.indexAll();
    expect(server.searchNodes('fooOld').length).toBeGreaterThan(0);
    expect(server.searchNodes('fooNew').length).toBe(0);

    fs.rmSync(getOmniWeaveDir(root), { recursive: true, force: true });
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export function fooNew() { return 2; }\n');
    const fresh = OmniWeave.initSync(root);
    await fresh.indexAll();
    fresh.destroy();

    expect(server.searchNodes('fooNew').length).toBe(0);
    expect(server.searchNodes('fooOld').length).toBeGreaterThan(0);

    expect(server.reopenIfReplaced()).toBe(true);
    expect(server.searchNodes('fooNew').length).toBeGreaterThan(0);
    expect(server.searchNodes('fooOld').length).toBe(0);
    expect(server.reopenIfReplaced()).toBe(false);

    server.destroy();
  });

  posixOnly('is a no-op when the index has not been replaced', async () => {
    const server = OmniWeave.initSync(root);
    await server.indexAll();
    expect(server.reopenIfReplaced()).toBe(false);
    server.destroy();
  });
});
