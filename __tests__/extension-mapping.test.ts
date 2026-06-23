import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { OmniWeave } from '../src';
import { detectLanguage, isSourceFile } from '../src/extraction/grammars';
import { clearProjectConfigCache, loadExtensionOverrides, PROJECT_CONFIG_FILENAME } from '../src/project-config';

describe('custom extension to language mapping', () => {
  describe('detectLanguage / isSourceFile overrides', () => {
    it('maps a custom extension only when an override is present', () => {
      expect(detectLanguage('a/b.foo')).toBe('unknown');
      expect(isSourceFile('a/b.foo')).toBe(false);

      expect(detectLanguage('a/b.foo', undefined, { '.foo': 'typescript' })).toBe('typescript');
      expect(isSourceFile('a/b.foo', { '.foo': 'typescript' })).toBe(true);
    });

    it('lets a user mapping take precedence over a built-in extension', () => {
      expect(detectLanguage('x.h')).toBe('c');
      expect(detectLanguage('x.h', undefined, { '.h': 'cpp' })).toBe('cpp');
    });

    it('keeps zero-config behavior unchanged', () => {
      expect(detectLanguage('x.ts')).toBe('typescript');
      expect(detectLanguage('x.py')).toBe('python');
      expect(isSourceFile('x.ts')).toBe(true);
      expect(isSourceFile('x.unknownext')).toBe(false);
    });
  });

  describe('loadExtensionOverrides', () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-extmap-'));
      clearProjectConfigCache();
    });

    afterEach(() => {
      clearProjectConfigCache();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const writeConfig = (obj: unknown) => {
      fs.writeFileSync(
        path.join(dir, PROJECT_CONFIG_FILENAME),
        typeof obj === 'string' ? obj : JSON.stringify(obj)
      );
    };

    it('returns an empty map when there is no config file', () => {
      expect(loadExtensionOverrides(dir)).toEqual({});
    });

    it('loads and validates a well-formed extensions map', () => {
      writeConfig({ extensions: { '.foo': 'typescript', '.bar': 'python' } });
      expect(loadExtensionOverrides(dir)).toEqual({ '.foo': 'typescript', '.bar': 'python' });
    });

    it('normalizes keys', () => {
      writeConfig({ extensions: { foo: 'lua', '.BAR': 'go' } });
      expect(loadExtensionOverrides(dir)).toEqual({ '.foo': 'lua', '.bar': 'go' });
    });

    it('skips unsupported languages', () => {
      writeConfig({ extensions: { '.foo': 'typescript', '.bad': 'pyhton', '.x': 'unknown' } });
      expect(loadExtensionOverrides(dir)).toEqual({ '.foo': 'typescript' });
    });

    it('skips multi-part and otherwise unusable extension keys', () => {
      writeConfig({ extensions: { '.d.ts': 'typescript', 'a/b': 'go', '.': 'lua', '.ok': 'rust' } });
      expect(loadExtensionOverrides(dir)).toEqual({ '.ok': 'rust' });
    });

    it('ignores malformed JSON without throwing', () => {
      writeConfig('{ not: valid json ');
      expect(loadExtensionOverrides(dir)).toEqual({});
    });

    it('picks up a changed config', () => {
      writeConfig({ extensions: { '.foo': 'typescript' } });
      expect(loadExtensionOverrides(dir)).toEqual({ '.foo': 'typescript' });

      writeConfig({ extensions: { '.foo': 'go' } });
      const future = new Date(Date.now() + 2000);
      fs.utimesSync(path.join(dir, PROJECT_CONFIG_FILENAME), future, future);

      expect(loadExtensionOverrides(dir)).toEqual({ '.foo': 'go' });
    });
  });

  describe('indexAll honors omniweave.json end to end', () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-extmap-idx-'));
      clearProjectConfigCache();
    });

    afterEach(() => {
      clearProjectConfigCache();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const write = (rel: string, body: string) => {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    };

    const indexAndQuery = async () => {
      const cg = await OmniWeave.init(dir, { silent: true });
      await cg.indexAll();
      const db = (cg as any).db.db;
      const nodes = db
        .prepare('SELECT name, kind, file_path, language FROM nodes WHERE file_path = ?')
        .all('widget.foo');
      const files = db
        .prepare('SELECT path, language FROM files WHERE path = ?')
        .all('widget.foo');
      cg.close();
      return { nodes, files };
    };

    const source = 'export function widgetHandler(x: number): number { return x + 1; }\n';

    it('indexes a custom-extension file mapped to a supported language', async () => {
      write(PROJECT_CONFIG_FILENAME, JSON.stringify({ extensions: { '.foo': 'typescript' } }));
      write('widget.foo', source);

      const { nodes, files } = await indexAndQuery();

      expect(files).toHaveLength(1);
      expect(files[0].language).toBe('typescript');
      expect(nodes.some((n: any) => n.name === 'widgetHandler' && n.language === 'typescript')).toBe(true);
    });

    it('does not index the same file without config', async () => {
      write('widget.foo', source);

      const { nodes, files } = await indexAndQuery();

      expect(files).toHaveLength(0);
      expect(nodes).toHaveLength(0);
    });

    it('removes a custom-extension file during sync after its mapping is removed', async () => {
      write(PROJECT_CONFIG_FILENAME, JSON.stringify({ extensions: { '.foo': 'typescript' } }));
      write('widget.foo', source);

      const cg = await OmniWeave.init(dir, { silent: true });
      await cg.indexAll();
      fs.unlinkSync(path.join(dir, PROJECT_CONFIG_FILENAME));
      clearProjectConfigCache();

      const sync = await cg.sync();
      const db = (cg as any).db.db;
      const files = db.prepare('SELECT path FROM files WHERE path = ?').all('widget.foo');
      const nodes = db.prepare('SELECT name FROM nodes WHERE file_path = ?').all('widget.foo');
      cg.close();

      expect(sync.filesRemoved).toBe(1);
      expect(files).toHaveLength(0);
      expect(nodes).toHaveLength(0);
    });

    it('detects git fast-path changes for mapped extensions', async () => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
      write(PROJECT_CONFIG_FILENAME, JSON.stringify({ extensions: { '.foo': 'typescript' } }));
      write('widget.foo', source);
      execFileSync('git', ['add', PROJECT_CONFIG_FILENAME, 'widget.foo'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'ignore' });

      const cg = await OmniWeave.init(dir, { silent: true });
      await cg.indexAll();
      write('widget.foo', 'export function widgetHandler(x: number): number { return x + 2; }\n');

      const changes = cg.getChangedFiles();
      cg.close();

      expect(changes.modified).toContain('widget.foo');
      expect(changes.added).toHaveLength(0);
      expect(changes.removed).toHaveLength(0);
    });
  });
});
