import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import OmniWeave from '../src/index';
import { CALL_SURFACE_EDGE_KIND_LIST } from '../src/call-surface';
import { initGrammars, loadAllGrammars } from '../src/extraction/grammars';

beforeAll(async () => {
  await initGrammars();
  await loadAllGrammars();
});

describe('graph trust boundaries', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempProject(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  it('keeps the agent call surface as one shared four-edge contract', () => {
    expect(CALL_SURFACE_EDGE_KIND_LIST).toEqual(['calls', 'crossLang', 'invokes', 'instantiates']);
  });

  it('keeps R S4 dispatch edges deterministic, without heuristic confidence', async () => {
    const dir = makeTempProject('omniweave-s4-trust-');
    fs.writeFileSync(
      path.join(dir, 'model.R'),
      [
        'setClass("GeneModel", slots = c(counts = "numeric"))',
        'setGeneric("fit", function(x) standardGeneric("fit"))',
        'setMethod("fit", "GeneModel", function(x) x)',
        '',
      ].join('\n')
    );

    const cg = OmniWeave.initSync(dir);
    try {
      await cg.indexAll();
      const cls = cg.getNodesByName('GeneModel').find((n) => n.kind === 'class');
      const generic = cg.getNodesByName('fit').find((n) => n.kind === 'function' && n.qualifiedName === 'fit');
      const method = cg.getNodesByName('fit').find((n) => n.kind === 'method' && n.qualifiedName === 'GeneModel::fit');
      expect(cls).toBeDefined();
      expect(generic).toBeDefined();
      expect(method).toBeDefined();

      const contains = cg.getIncomingEdges(method!.id).find((e) => e.kind === 'contains' && e.source === cls!.id);
      const overrides = cg.getOutgoingEdges(method!.id).find((e) => e.kind === 'overrides' && e.target === generic!.id);
      expect(contains).toBeDefined();
      expect(overrides).toBeDefined();
      for (const edge of [contains!, overrides!]) {
        expect(edge.provenance ?? undefined).toBeUndefined();
        expect(edge.metadata?.confidence).toBeUndefined();
      }
    } finally {
      cg.destroy();
    }
  });

  it('marks general cross-process crossLang edges as heuristic with confidence', async () => {
    const dir = makeTempProject('omniweave-crosslang-trust-');
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'pipeline.py'),
      [
        'import subprocess',
        '',
        'def run_analysis():',
        '    subprocess.run(["Rscript", "scripts/deseq.R"], check=True)',
        '',
      ].join('\n')
    );
    fs.writeFileSync(path.join(dir, 'scripts', 'deseq.R'), 'run <- function() "ok"\n');

    const cg = OmniWeave.initSync(dir);
    try {
      await cg.indexAll();
      const caller = cg.getNodesByName('run_analysis').find((n) => n.kind === 'function');
      expect(caller).toBeDefined();
      const edge = cg.getOutgoingEdges(caller!.id).find((e) => e.kind === 'crossLang');
      expect(edge).toBeDefined();
      const target = cg.getNode(edge!.target);
      expect(target?.filePath).toBe('scripts/deseq.R');
      expect(edge!.provenance).toBe('heuristic');
      expect(edge!.metadata?.synthesizedBy).toBe('general-crosslang');
      expect(typeof edge!.metadata?.confidence).toBe('number');
      expect(edge!.metadata?.confidence).toBeGreaterThanOrEqual(0.8);
      expect(edge!.metadata?.confidence).toBeLessThanOrEqual(0.95);
    } finally {
      cg.destroy();
    }
  });
});
