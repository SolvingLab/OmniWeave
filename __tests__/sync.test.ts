/**
 * Sync Module Tests
 *
 * Tests for sync functionality (incremental updates).
 * Note: Git hooks functionality has been removed in favor of omniweave's
 * Claude Code hooks integration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import OmniWeave from '../src/index';

describe('Sync Module', () => {
  describe('Sync Functionality', () => {
    let testDir: string;
    let cg: OmniWeave;

    beforeEach(async () => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-sync-func-'));

      // Create initial source files
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir);
      fs.writeFileSync(
        path.join(srcDir, 'index.ts'),
        `export function hello() { return 'world'; }`
      );

      // Initialize and index
      cg = OmniWeave.initSync(testDir, {
        config: {
          include: ['**/*.ts'],
          exclude: [],
        },
      });
      await cg.indexAll();
    });

    afterEach(() => {
      if (cg) {
        cg.destroy();
      }
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    describe('getChangedFiles()', () => {
      it('should detect added files', () => {
        // Add a new file
        fs.writeFileSync(
          path.join(testDir, 'src', 'new.ts'),
          `export function newFunc() { return 42; }`
        );

        const changes = cg.getChangedFiles();

        expect(changes.added).toContain('src/new.ts');
        expect(changes.modified).toHaveLength(0);
        expect(changes.removed).toHaveLength(0);
      });

      it('should detect modified files', () => {
        // Modify existing file
        fs.writeFileSync(
          path.join(testDir, 'src', 'index.ts'),
          `export function hello() { return 'modified'; }`
        );

        const changes = cg.getChangedFiles();

        expect(changes.added).toHaveLength(0);
        expect(changes.modified).toContain('src/index.ts');
        expect(changes.removed).toHaveLength(0);
      });

      it('should detect removed files', () => {
        // Remove file
        fs.unlinkSync(path.join(testDir, 'src', 'index.ts'));

        const changes = cg.getChangedFiles();

        expect(changes.added).toHaveLength(0);
        expect(changes.modified).toHaveLength(0);
        expect(changes.removed).toContain('src/index.ts');
      });
    });

    describe('sync()', () => {
      it('should reindex added files', async () => {
        // Add a new file
        fs.writeFileSync(
          path.join(testDir, 'src', 'new.ts'),
          `export function newFunc() { return 42; }`
        );

        const result = await cg.sync();

        expect(result.filesAdded).toBe(1);
        expect(result.filesModified).toBe(0);
        expect(result.filesRemoved).toBe(0);

        // Verify new function is in the graph
        const nodes = cg.searchNodes('newFunc');
        expect(nodes.length).toBeGreaterThan(0);
      });

      it('should reindex modified files', async () => {
        // Modify existing file
        fs.writeFileSync(
          path.join(testDir, 'src', 'index.ts'),
          `export function goodbye() { return 'farewell'; }`
        );

        const result = await cg.sync();

        expect(result.filesModified).toBe(1);

        // Verify new function is in the graph
        const nodes = cg.searchNodes('goodbye');
        expect(nodes.length).toBeGreaterThan(0);

        // Verify old function is gone
        const oldNodes = cg.searchNodes('hello');
        expect(oldNodes.length).toBe(0);
      });

      it('should remove nodes from deleted files', async () => {
        // Remove file
        fs.unlinkSync(path.join(testDir, 'src', 'index.ts'));

        const result = await cg.sync();

        expect(result.filesRemoved).toBe(1);

        // Verify function is gone
        const nodes = cg.searchNodes('hello');
        expect(nodes.length).toBe(0);
      });

      it('should report no changes when nothing changed', async () => {
        const result = await cg.sync();

        expect(result.filesAdded).toBe(0);
        expect(result.filesModified).toBe(0);
        expect(result.filesRemoved).toBe(0);
        expect(result.filesChecked).toBeGreaterThan(0);
      });
    });
  });

  describe('Git-based sync', () => {
    let testDir: string;
    let cg: OmniWeave;

    function git(...args: string[]) {
      execFileSync('git', args, { cwd: testDir, stdio: 'pipe' });
    }

    beforeEach(async () => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-git-sync-'));

      // Initialize a git repo with an initial commit
      git('init');
      git('config', 'user.email', 'test@test.com');
      git('config', 'user.name', 'Test');

      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir);
      fs.writeFileSync(
        path.join(srcDir, 'index.ts'),
        `export function hello() { return 'world'; }`
      );

      git('add', '-A');
      git('commit', '-m', 'initial');

      // Initialize OmniWeave and index
      cg = OmniWeave.initSync(testDir, {
        config: {
          include: ['**/*.ts'],
          exclude: [],
        },
      });
      await cg.indexAll();
    });

    afterEach(() => {
      if (cg) {
        cg.destroy();
      }
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should detect modified files via git', async () => {
      fs.writeFileSync(
        path.join(testDir, 'src', 'index.ts'),
        `export function hello() { return 'modified'; }`
      );

      const result = await cg.sync();

      expect(result.filesModified).toBe(1);
      expect(result.changedFilePaths).toContain('src/index.ts');
    });

    it('should detect new untracked files via git', async () => {
      fs.writeFileSync(
        path.join(testDir, 'src', 'new.ts'),
        `export function newFunc() { return 42; }`
      );

      const result = await cg.sync();

      expect(result.filesAdded).toBe(1);
      expect(result.changedFilePaths).toContain('src/new.ts');

      // Verify the function was indexed
      const nodes = cg.searchNodes('newFunc');
      expect(nodes.length).toBeGreaterThan(0);
    });

    it('should stop reporting untracked files once they are indexed (issue #206)', async () => {
      // Untracked files stay `??` in git status even after omniweave indexes
      // them. Change detection must compare them against the DB by hash, not
      // report every untracked file as "added" on every sync/status.
      fs.writeFileSync(
        path.join(testDir, 'src', 'new.ts'),
        `export function newFunc() { return 42; }`
      );

      // First sync indexes the untracked file.
      const first = await cg.sync();
      expect(first.filesAdded).toBe(1);

      // The file is still untracked in git, but now lives in the DB.
      expect(cg.searchNodes('newFunc').length).toBeGreaterThan(0);

      // status must not keep flagging it as a pending addition...
      const changes = cg.getChangedFiles();
      expect(changes.added).not.toContain('src/new.ts');
      expect(changes.modified).not.toContain('src/new.ts');

      // ...and a second sync must be a no-op for it.
      const second = await cg.sync();
      expect(second.filesAdded).toBe(0);
      expect(second.filesModified).toBe(0);
    });

    it('should re-index an untracked file when its contents change', async () => {
      const filePath = path.join(testDir, 'src', 'new.ts');
      fs.writeFileSync(filePath, `export function newFunc() { return 42; }`);
      await cg.sync();

      // Modify the still-untracked file.
      fs.writeFileSync(filePath, `export function renamedFunc() { return 7; }`);

      const changes = cg.getChangedFiles();
      expect(changes.modified).toContain('src/new.ts');

      const result = await cg.sync();
      expect(result.filesModified).toBe(1);
      expect(cg.searchNodes('renamedFunc').length).toBeGreaterThan(0);
      expect(cg.searchNodes('newFunc').length).toBe(0);
    });

    it('should detect deleted files via git', async () => {
      fs.unlinkSync(path.join(testDir, 'src', 'index.ts'));

      const result = await cg.sync();

      expect(result.filesRemoved).toBe(1);

      // Verify function is gone
      const nodes = cg.searchNodes('hello');
      expect(nodes.length).toBe(0);
    });

    it('does not report a staged deletion when the same source file still exists on disk', async () => {
      git('rm', '--cached', 'src/index.ts');

      const changes = cg.getChangedFiles();

      expect(changes.removed).not.toContain('src/index.ts');
      expect(changes.added).not.toContain('src/index.ts');
      expect(changes.modified).not.toContain('src/index.ts');

      const result = await cg.sync();
      expect(result.filesRemoved).toBe(0);
      expect(result.filesAdded).toBe(0);
      expect(result.filesModified).toBe(0);
      expect(cg.searchNodes('hello').length).toBeGreaterThan(0);
    });

    it('should skip files with unsupported extensions', async () => {
      // A .txt file has no supported grammar, so sync must not index it.
      fs.writeFileSync(
        path.join(testDir, 'src', 'notes.txt'),
        `just some notes`
      );

      const result = await cg.sync();

      expect(result.filesAdded).toBe(0);
      expect(result.filesModified).toBe(0);
    });

    it('should report no changes on clean working tree', async () => {
      const result = await cg.sync();

      expect(result.filesAdded).toBe(0);
      expect(result.filesModified).toBe(0);
      expect(result.filesRemoved).toBe(0);
      expect(result.changedFilePaths).toBeUndefined();
    });
  });

  describe('Incremental sync honors the same ignore rules as full index', () => {
    let testDir: string;
    let cg: OmniWeave;

    function git(...args: string[]) {
      execFileSync('git', args, { cwd: testDir, stdio: 'pipe' });
    }

    beforeEach(async () => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-ignore-sync-'));

      git('init');
      git('config', 'user.email', 'test@test.com');
      git('config', 'user.name', 'Test');
      git('config', 'commit.gpgsign', 'false');

      fs.mkdirSync(path.join(testDir, 'src'));
      fs.writeFileSync(path.join(testDir, 'src', 'index.ts'), `export function hello() { return 'world'; }`);

      fs.mkdirSync(path.join(testDir, 'vendor'));
      fs.writeFileSync(path.join(testDir, 'vendor', 'lib.ts'), `export function vendoredHelper() { return 1; }`);

      fs.writeFileSync(path.join(testDir, '.gitignore'), 'generated/\n');
      fs.mkdirSync(path.join(testDir, 'generated'));
      fs.writeFileSync(path.join(testDir, 'generated', 'out.ts'), `export function generatedThing() { return 2; }`);

      git('add', '-A');
      git('add', '-f', 'generated/out.ts');
      git('commit', '-m', 'initial');

      cg = OmniWeave.initSync(testDir, {
        config: { include: ['**/*.ts'], exclude: [] },
      });
      await cg.indexAll();
    });

    afterEach(() => {
      if (cg) cg.destroy();
      if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('full index excludes built-in and .gitignored directories', () => {
      expect(cg.searchNodes('hello').length).toBeGreaterThan(0);
      expect(cg.searchNodes('vendoredHelper')).toHaveLength(0);
      expect(cg.searchNodes('generatedThing')).toHaveLength(0);
    });

    it('does not report a modified tracked file in a built-in excluded dir', () => {
      fs.writeFileSync(path.join(testDir, 'vendor', 'lib.ts'), `export function vendoredHelper() { return 999; }`);
      const changes = cg.getChangedFiles();
      expect(changes.modified).not.toContain('vendor/lib.ts');
      expect(changes.added).not.toContain('vendor/lib.ts');
    });

    it('does not report a modified tracked file in a .gitignored dir', () => {
      fs.writeFileSync(path.join(testDir, 'generated', 'out.ts'), `export function generatedThing() { return 999; }`);
      const changes = cg.getChangedFiles();
      expect(changes.modified).not.toContain('generated/out.ts');
      expect(changes.added).not.toContain('generated/out.ts');
    });

    it('still reports a normal modified source file', () => {
      fs.writeFileSync(path.join(testDir, 'src', 'index.ts'), `export function hello() { return 'changed'; }`);
      expect(cg.getChangedFiles().modified).toContain('src/index.ts');
    });
  });

  describe('Cross-file caller edges survive callee re-index', () => {
    let testDir: string;
    let cg: OmniWeave;

    beforeEach(async () => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-caller-sync-'));
      fs.mkdirSync(path.join(testDir, 'pkg'), { recursive: true });
      fs.mkdirSync(path.join(testDir, 'test'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'pkg', '__init__.py'), '');
      fs.writeFileSync(
        path.join(testDir, 'pkg', 'mod.py'),
        [
          'def callee_one(value):',
          '    """First callee."""',
          '    return value + 1',
          '',
          '',
          'def callee_two(value):',
          '    """Second callee."""',
          '    return value + 2',
          '',
        ].join('\n')
      );
      fs.writeFileSync(
        path.join(testDir, 'test', 'test_callers.py'),
        [
          'from pkg import mod',
          '',
          '',
          'def test_calls_callee_one():',
          '    assert mod.callee_one(1) == 2',
          '',
          '',
          'def test_calls_callee_two():',
          '    assert mod.callee_two(1) == 3',
          '',
        ].join('\n')
      );

      cg = OmniWeave.initSync(testDir, {
        config: { include: ['**/*.py'], exclude: [] },
      });
      await cg.indexAll();
    });

    afterEach(() => {
      if (cg) cg.destroy();
      if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    });

    function callerCount(name: string): number {
      const node = cg.searchNodes(name).map((r) => r.node).find((n) => n.kind === 'function' && n.name === name);
      return node ? cg.getCallers(node.id).length : -1;
    }

    it('preserves incoming cross-file call edges when line numbers shift', async () => {
      expect(callerCount('callee_one')).toBe(1);
      expect(callerCount('callee_two')).toBe(1);

      fs.writeFileSync(
        path.join(testDir, 'pkg', 'mod.py'),
        [
          'def callee_one(value):',
          '    """First callee."""',
          '    """Extra docstring line shifts the next function."""',
          '    return value + 1',
          '',
          '',
          'def callee_two(value):',
          '    """Second callee."""',
          '    return value + 2',
          '',
        ].join('\n')
      );

      const result = await cg.sync();
      expect(result.filesModified).toBe(1);
      expect(callerCount('callee_one')).toBe(1);
      expect(callerCount('callee_two')).toBe(1);
    });

    it('drops incoming edges for a callee that was renamed', async () => {
      expect(callerCount('callee_one')).toBe(1);

      fs.writeFileSync(
        path.join(testDir, 'pkg', 'mod.py'),
        [
          'def callee_one_renamed(value):',
          '    return value + 1',
          '',
          '',
          'def callee_two(value):',
          '    return value + 2',
          '',
        ].join('\n')
      );

      await cg.sync();
      expect(callerCount('callee_one')).toBe(-1);
      expect(callerCount('callee_one_renamed')).toBe(0);
      expect(callerCount('callee_two')).toBe(1);
    });
  });
});
