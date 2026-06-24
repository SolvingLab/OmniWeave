import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { OmniWeave } from '../src';
import type { Edge } from '../src/types';

/**
 * Same-file module-variable/constant reference synthesizer. "Which functions use this
 * module constant?" is a core impact-analysis query before changing a config value.
 * Extraction records references to TYPES (param/return/field) but not to value symbols,
 * so a function that uses a module-level constant has no traversable edge. This bridges
 * it — same-file, exact-name, comment/string stripped, shadowing-aware — at higher
 * precision than a raw text match. The negative cases ARE the point: a fabricated
 * reference (to a shadowed local, a string mention, or a cross-file name) is 错边.
 */
describe('Module-variable reference synthesizer', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-var-ref-fixture-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const moduleVarRef = (edges: Edge[], targetId: string): Edge | undefined =>
    edges.find(
      (e) =>
        e.target === targetId &&
        e.kind === 'references' &&
        (e.metadata as { synthesizedBy?: string } | undefined)?.synthesizedBy === 'module-var-ref'
    );

  it('references module constants used in a body, and refuses shadowed / string / cross-file uses', async () => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'config.py'),
      `MAX_RETRIES = 5
TIMEOUT = 30
API_KEY = "secret"

def fetch(url):
    for i in range(MAX_RETRIES):
        connect(url, TIMEOUT)
    return "MAX_RETRIES in a string should NOT count"

def shadowed(MAX_RETRIES):
    return MAX_RETRIES + 1

def local_decl():
    TIMEOUT = 99
    return TIMEOUT
`
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'other.py'),
      `def remote():
    return MAX_RETRIES
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const fns = cg.getNodesByKind('function');
    const vars = [...cg.getNodesByKind('variable'), ...cg.getNodesByKind('constant')];
    const fetch = fns.find((n) => n.name === 'fetch');
    const shadowed = fns.find((n) => n.name === 'shadowed');
    const localDecl = fns.find((n) => n.name === 'local_decl');
    const remote = fns.find((n) => n.name === 'remote');
    const MAX_RETRIES = vars.find((n) => n.name === 'MAX_RETRIES');
    const TIMEOUT = vars.find((n) => n.name === 'TIMEOUT');
    const API_KEY = vars.find((n) => n.name === 'API_KEY');
    expect(fetch && shadowed && localDecl && remote && MAX_RETRIES && TIMEOUT && API_KEY).toBeTruthy();

    const fetchEdges = cg.getOutgoingEdges(fetch!.id);
    // TRUE positives — real uses in the body.
    const toMax = moduleVarRef(fetchEdges, MAX_RETRIES!.id);
    expect(toMax).toBeDefined();
    expect((toMax!.metadata as { confidence?: number }).confidence).toBe(0.8);
    expect(moduleVarRef(fetchEdges, TIMEOUT!.id)).toBeDefined();
    // 错边 guards — none of these may be fabricated.
    expect(moduleVarRef(fetchEdges, API_KEY!.id)).toBeUndefined(); // only in a string
    expect(moduleVarRef(cg.getOutgoingEdges(shadowed!.id), MAX_RETRIES!.id)).toBeUndefined(); // param shadow
    expect(moduleVarRef(cg.getOutgoingEdges(localDecl!.id), TIMEOUT!.id)).toBeUndefined(); // local re-decl
    expect(moduleVarRef(cg.getOutgoingEdges(remote!.id), MAX_RETRIES!.id)).toBeUndefined(); // cross-file
  });

  it('does not reference a name shared by a function in the same file (ambiguous)', async () => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'amb.py'),
      `handler = 1

def handler():
    return 2

def use():
    return handler
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const use = cg.getNodesByKind('function').find((n) => n.name === 'use');
    expect(use).toBeDefined();
    const synthesized = cg
      .getOutgoingEdges(use!.id)
      .filter((e) => (e.metadata as { synthesizedBy?: string } | undefined)?.synthesizedBy === 'module-var-ref');
    expect(synthesized).toHaveLength(0);
  });
});
