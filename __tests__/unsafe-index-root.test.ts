import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { unsafeIndexRootReason } from '../src/directory';

describe('unsafeIndexRootReason', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort temp cleanup.
      }
    }
  });

  it('flags the home directory', () => {
    const reason = unsafeIndexRootReason(os.homedir());
    expect(reason).toBeTruthy();
    expect(reason).toContain('home');
  });

  it('flags a parent of the home directory', () => {
    expect(unsafeIndexRootReason(path.dirname(os.homedir()))).toBeTruthy();
  });

  it.runIf(process.platform !== 'win32')('flags the POSIX filesystem root', () => {
    expect(unsafeIndexRootReason('/')).toContain('filesystem root');
  });

  it('allows a normal project directory and nested project subdir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-safe-root-'));
    tmpDirs.push(dir);
    expect(unsafeIndexRootReason(dir)).toBeNull();

    const nested = path.join(dir, 'packages', 'app');
    fs.mkdirSync(nested, { recursive: true });
    expect(unsafeIndexRootReason(nested)).toBeNull();
  });

  it('matches the home directory case-insensitively on macOS and Windows', () => {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return;
    expect(unsafeIndexRootReason(os.homedir().toUpperCase())).toBeTruthy();
  });
});
