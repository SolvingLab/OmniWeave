/**
 * omniweave_node FILE READ mode: a `file` with no `symbol` reads that file like
 * the Read tool — current source with `<n>\t<line>` numbering (byte-for-byte
 * Read's shape), narrowable with offset/limit — plus a one-line blast-radius
 * header. `symbolsOnly` returns the structural map instead. Config/data files
 * are summarized by key, never dumped (#383).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import OmniWeave from '../src/index';
import { ToolHandler } from '../src/mcp/tools';

describe('omniweave_node file-view (Read replacement)', () => {
  let dir: string;
  let cg: OmniWeave;
  let h: ToolHandler;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-fileview-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
      path.join(dir, 'src', 'a.ts'),
      'export function helper(x: number) {\n  return x + 1;\n}\nexport class Widget {\n  build() { return helper(1); }\n}\n',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'b.ts'),
      "import { helper } from './a';\n\n// a comment between symbols\nconst SETTING = 7;\nexport function useHelper() { return helper(2) + SETTING; }\n",
    );
    // A config/data file (#383): its values may be secrets and must never be
    // dumped verbatim by the file-view.
    fs.writeFileSync(
      path.join(dir, 'src', 'application.properties'),
      'spring.datasource.password=SUPERSECRET123\nserver.port=8080\n',
    );
    // A large file: exceeds the file-view line budget, so it must be windowed
    // honestly (not silently truncated).
    fs.writeFileSync(
      path.join(dir, 'src', 'big.ts'),
      'export function big() {\n' +
        Array.from({ length: 2000 }, (_, i) => `  const v${i} = ${i};`).join('\n') +
        '\n  return 0;\n}\n',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'c.ts'),
      "import { big } from './big';\n\nexport function useBig() { return big(); }\n",
    );
    cg = OmniWeave.initSync(dir, { config: { include: ['**/*.ts', '**/*.properties'], exclude: [] } });
    await cg.indexAll();
    h = new ToolHandler(cg);
  });

  afterEach(() => {
    if (cg) cg.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const text = async (args: Record<string, unknown>): Promise<string> =>
    (await h.execute('omniweave_node', args)).content.map((c) => c.text).join('\n');

  it('reads a whole file like Read by default — `<n>\\t<line>` lines (no pad), imports + gaps included', async () => {
    const out = await text({ file: 'b.ts' }); // no includeCode needed — content is the default
    // Byte-for-byte Read shape: line 1 is "1<TAB>import …", NOT space-padded.
    expect(out).toMatch(/^1\timport \{ helper \} from '\.\/a';$/m);
    expect(out).toContain('// a comment between symbols'); // inter-symbol gap (Read has it; old reconstruction dropped it)
    expect(out).toContain('const SETTING = 7'); // top-level statement
    expect(out).toContain('useHelper'); // the symbol body too
    expect(out).not.toContain('```'); // Read has no code fence; neither do we
  });

  it('leads with a one-line blast-radius header (the value-add over Read)', async () => {
    const out = await text({ file: 'a.ts' });
    expect(out).toMatch(/used by 1 file: src\/b\.ts/); // a.ts is imported by b.ts
    expect(out).toContain('return x + 1'); // still returns the source
  });

  it('offset/limit narrow the window exactly like Read', async () => {
    const out = await text({ file: 'big.ts', offset: 1000, limit: 3 });
    // Window starts at the requested line, numbered exactly: "1000<TAB>  const v998 = 998;"
    expect(out).toMatch(/^1000\t {2}const v998 = 998;$/m);
    expect(out).not.toMatch(/^1\t/m); // line 1 is NOT shown
    expect(out).toMatch(/lines 1000[–-]1002 of \d+/); // honest pagination note
  });

  it('an offset past EOF is reported, not a crash', async () => {
    const out = await text({ file: 'a.ts', offset: 9999 });
    expect(out).toMatch(/past the end/i);
  });

  it('paginates a large file honestly by default — "lines 1–N of TOTAL", never a silent truncate', async () => {
    const out = await text({ file: 'big.ts' });
    expect(out).toMatch(/lines 1[–-]\d+ of \d+/); // explicit window note
    expect(out).not.toContain('(output truncated)'); // not the generic 15k chop
    expect(out).toMatch(/^1\texport function big/m); // the head of the window is real source
  });

  it('keeps a large symbol trail before the source body can be truncated', async () => {
    const out = await text({ symbol: 'big', includeCode: true });

    expect(out).toContain('### Trail');
    expect(out).toContain('useBig (src/c.ts:3)');
    expect(out.indexOf('### Trail')).toBeGreaterThanOrEqual(0);
    expect(out.indexOf('### Trail')).toBeLessThan(out.indexOf('```typescript'));
    expect(out).toContain('... (output truncated)');
  });

  it('does NOT dump a config/data file (yaml/properties) — #383 secret safety', async () => {
    const out = await text({ file: 'application.properties' });
    expect(out).not.toContain('SUPERSECRET123'); // the value never reaches the agent
    expect(out.toLowerCase()).toMatch(/config|values withheld/);
  });

  it('symbolsOnly returns the structural map, not the source', async () => {
    const out = await text({ file: 'a.ts', symbolsOnly: true });
    expect(out).toContain('### Symbols');
    expect(out).toContain('helper');
    expect(out).toContain('Widget');
    expect(out).not.toContain('return x + 1'); // bodies are NOT included in the map
  });

  it('still works as a normal symbol lookup (no regression)', async () => {
    const out = await text({ symbol: 'helper', includeCode: true });
    expect(out).toContain('helper');
    expect(out).toContain('return x + 1');
  });

  it('a miss returns a helpful message, not a crash', async () => {
    const out = await text({ file: 'does-not-exist.ts' });
    expect(out).toMatch(/no indexed file matches/i);
  });

  it('reports an initialized 0-file index without telling MCP agents to rebuild from shell', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-empty-fileview-'));
    let emptyCg: OmniWeave | undefined;

    try {
      emptyCg = OmniWeave.initSync(emptyDir, {
        config: { include: ['**/*.ts'], exclude: [] },
      });
      const emptyHandler = new ToolHandler(emptyCg);

      const mcpNode = (await emptyHandler.execute('omniweave_node', { file: 'src/missing.ts' }))
        .content.map((c) => c.text).join('\n');
      const mcpFiles = (await emptyHandler.execute('omniweave_files', {}))
        .content.map((c) => c.text).join('\n');
      const cliNode = (await emptyHandler.execute(
        'omniweave_node',
        { file: 'src/missing.ts' },
        { outputSurface: 'cli' },
      )).content.map((c) => c.text).join('\n');
      const cliFiles = (await emptyHandler.execute(
        'omniweave_files',
        {},
        { outputSurface: 'cli' },
      )).content.map((c) => c.text).join('\n');

      for (const out of [mcpNode, mcpFiles]) {
        expect(out).toContain('initialized but contains 0 files');
        expect(out).toContain('empty index state, not a tool failure');
        expect(out).toContain('Refresh the index');
        expect(out).not.toContain('omniweave index');
        expect(out).not.toContain('omniweave sync');
      }
      for (const out of [cliNode, cliFiles]) {
        expect(out).toContain('initialized but contains 0 files');
        expect(out).toContain('empty index state, not a tool failure');
        expect(out).toContain('omniweave sync');
        expect(out).not.toContain('omniweave index');
      }
    } finally {
      emptyCg?.close();
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
