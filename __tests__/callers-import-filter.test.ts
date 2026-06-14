/**
 * callers/callees exclude plain `import` edges.
 *
 * getCallers() returns every incoming dependency edge — including the `imports`
 * edge a file gets for importing the name. A file importing X is a DEPENDENCY,
 * not a caller, and it is redundant with the function-level call edges from the
 * same file. Surfacing it as a caller inflated the "(N found)" count and forced
 * the agent to subtract the noise (measured on vscode: a symbol returned 80 =
 * 57 real callers + 23 file imports). callers/callees now drop `imports` edges;
 * the full dependency closure (importers included) stays on omniweave_impact.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OmniWeave } from '../src';
import { ToolHandler } from '../src/mcp/tools';
import { initGrammars, loadAllGrammars } from '../src/extraction/grammars';

let tmpDir: string;
let cg: OmniWeave;
let handler: ToolHandler;

const text = async (tool: string, args: Record<string, unknown>): Promise<string> => {
  const res = await handler.execute(tool, args);
  return res.content?.[0]?.text ?? '';
};

beforeAll(async () => {
  await initGrammars();
  await loadAllGrammars();

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-import-'));
  const mk = (rel: string, content: string) => {
    const p = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };

  // `widget` is exported here and imported (→ an `imports` edge per file) AND
  // called (→ a `calls` edge from the enclosing function) by two consumers.
  mk('src/lib.ts', `export function widget() { return 1; }\n`);
  mk('src/consumerA.ts', `import { widget } from './lib';\nexport function useWidgetA() { return widget(); }\n`);
  mk('src/consumerB.ts', `import { widget } from './lib';\nexport function useWidgetB() { return widget() + 1; }\n`);

  cg = OmniWeave.initSync(tmpDir);
  await cg.indexAll();
  handler = new ToolHandler(cg);
}, 120_000);

afterAll(() => {
  cg?.destroy();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('callers/callees — exclude plain import edges', () => {
  it('the graph itself DOES record the import edges (so the filter is real work)', () => {
    const [widget] = cg.getNodesByName('widget').filter((n) => n.kind === 'function');
    expect(widget).toBeDefined();
    const incoming = cg.getIncomingEdges(widget!.id);
    // Sanity: without a filter, callers would include `imports` edges from the
    // two consumer files — this is exactly the noise the MCP layer must drop.
    expect(incoming.some((e) => e.kind === 'imports')).toBe(true);
  });

  it('callers: lists the real call-site functions, never the file `via import` nodes', async () => {
    const out = await text('omniweave_callers', { symbol: 'widget' });
    // Real callers are present…
    expect(out).toContain('useWidgetA');
    expect(out).toContain('useWidgetB');
    // …and the import noise is gone: no file-node entries, no "via import".
    expect(out).not.toContain('via import');
    expect(out).not.toMatch(/\(file\)/);
    // The count reflects the 2 real callers, not 2 callers + 2 file imports.
    expect(out).toContain('(2 found)');
  });

  it('omniweave_impact still sees the importers (dependency closure is not lost)', async () => {
    const out = await text('omniweave_impact', { symbol: 'widget', depth: 2 });
    // impact keeps the full incoming-edge set, so the consumer files/functions
    // still show up as affected by a change to widget.
    expect(out).toMatch(/useWidgetA|consumerA/);
    expect(out).toMatch(/useWidgetB|consumerB/);
  });
});
