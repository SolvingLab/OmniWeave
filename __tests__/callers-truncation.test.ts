/**
 * callers/callees limit-truncation signal.
 *
 * The flat caller/callee list is capped at `limit` (default 20). It used to
 * slice the list at the call site and then title it "(N found)" with N = the
 * SLICED length — so a high-fan-in symbol (the case the graph is meant to beat
 * grep on) reported "20 found" with no hint that more existed, and an agent
 * under-counted the fan-in. Now the header reports the TRUE total
 * ("showing 20 of 57") and a "+N more" footer gives the re-run hint, mirroring
 * formatImpact's depth-truncation note. This is the red→green gate for that fix.
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

const CALLER_COUNT = 25; // > the default limit of 20, < the 100 hard cap

const text = async (
  tool: string,
  args: Record<string, unknown>,
  options: Parameters<ToolHandler['execute']>[2] = {},
): Promise<string> => {
  const res = await handler.execute(tool, args, options);
  return res.content?.[0]?.text ?? '';
};

beforeAll(async () => {
  await initGrammars();
  await loadAllGrammars();

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-trunc-'));
  const mk = (rel: string, content: string) => {
    const p = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };

  // Keep everything in ONE file so same-file `calls` edges resolve cleanly, and
  // use symbol names that don't collide with any filename (so findAllSymbols
  // returns exactly one definition — the flat-list path).
  const callers = Array.from({ length: CALLER_COUNT }, (_, i) => `function caller${i}() { return target(); }`).join('\n');
  const deps = Array.from({ length: CALLER_COUNT }, (_, i) => `function dep${i}() { return ${i}; }`).join('\n');
  const fanOutBody = Array.from({ length: CALLER_COUNT }, (_, i) => `  dep${i}();`).join('\n');
  mk(
    'src/graph.ts',
    `function target() { return 1; }\n${callers}\n${deps}\nfunction fanOut() {\n${fanOutBody}\n}\n`,
  );

  cg = OmniWeave.initSync(tmpDir);
  await cg.indexAll();
  handler = new ToolHandler(cg);
}, 120_000);

afterAll(() => {
  cg?.destroy();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('callers/callees — limit-truncation signal', () => {
  it('callers: header reports the TRUE total, not the capped slice length', async () => {
    const out = await text('omniweave_callers', { symbol: 'target' }); // default limit 20
    // Must NOT claim "20 found" / "25 found" — it shows 20 OF 25.
    expect(out).toContain(`showing 20 of ${CALLER_COUNT}`);
    expect(out).not.toMatch(/Callers of target \(20 found\)/);
    // Exactly 20 caller lines are listed.
    const callerLines = out.split('\n').filter((l) => /^- caller\d+ /.test(l));
    expect(callerLines).toHaveLength(20);
  });

  it('callers: a capped list carries an actionable "+N more" re-run footer', async () => {
    const out = await text('omniweave_callers', { symbol: 'target' });
    expect(out).toContain('⚠️');
    expect(out).toContain(`Showing the first 20 of ${CALLER_COUNT}`);
    expect(out).toContain(`limit=${CALLER_COUNT}`); // exact number to ask for
  });

  it('callers: CLI surface prints shell continuations and shell limit hints', async () => {
    const out = await text('omniweave_callers', { symbol: 'target' }, { outputSurface: 'cli' });
    expect(out).toContain('cmd: `omniweave node "caller0" --file "src/graph.ts" --line ');
    expect(out).toContain(`--limit ${CALLER_COUNT}`);
    expect(out).not.toContain('omniweave_node');
    expect(out).not.toContain(`limit=${CALLER_COUNT}`);
  });

  it('callers: raising limit above the total drops the cap signal and lists all', async () => {
    const out = await text('omniweave_callers', { symbol: 'target', limit: 100 });
    expect(out).toContain(`(${CALLER_COUNT} found)`);
    expect(out).not.toContain('⚠️');
    expect(out).not.toContain('showing');
    const callerLines = out.split('\n').filter((l) => /^- caller\d+ /.test(l));
    expect(callerLines).toHaveLength(CALLER_COUNT);
  });

  it('callees: the same truncation signal applies to a fan-out function', async () => {
    const out = await text('omniweave_callees', { symbol: 'fanOut' }); // default limit 20
    expect(out).toContain(`showing 20 of ${CALLER_COUNT}`);
    expect(out).toContain(`Showing the first 20 of ${CALLER_COUNT}`);
    expect(out).toContain(`limit=${CALLER_COUNT}`);
  });

  it('callees: CLI surface keeps the same shell continuation contract', async () => {
    const out = await text('omniweave_callees', { symbol: 'fanOut' }, { outputSurface: 'cli' });
    expect(out).toContain('cmd: `omniweave node "dep0" --file "src/graph.ts" --line ');
    expect(out).toContain(`--limit ${CALLER_COUNT}`);
    expect(out).not.toContain('omniweave_node');
    expect(out).not.toContain(`limit=${CALLER_COUNT}`);
  });

  it('a hub past the 100-cap says "top 100" and reports the real total', async () => {
    // Unit-level check of the footer wording for the >100 hub case (no need to
    // index 100+ files): the note must name the 100 cap AND the true total.
    const note = (handler as unknown as { moreResultsNote(t: number, s: number): string })
      .moreResultsNote(137, 20);
    expect(note).toContain('limit=100');
    expect(note).toContain('hub: 137 total');
  });

  it('a CLI hub note names the shell flag, not the MCP argument shape', async () => {
    const note = (handler as unknown as { moreResultsNote(t: number, s: number, surface: 'cli'): string })
      .moreResultsNote(137, 20, 'cli');
    expect(note).toContain('--limit 100');
    expect(note).not.toContain('limit=100');
    expect(note).toContain('hub: 137 total');
  });
});
