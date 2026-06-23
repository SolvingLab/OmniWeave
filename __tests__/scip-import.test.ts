import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import OmniWeave from '../src/index';
import { importScipIndex, type ImportScipResult } from '../src/scip/importer';

const BIN = path.resolve(__dirname, '../dist/bin/omniweave.js');
const REAL_SCIP_TYPESCRIPT_FIXTURE = path.resolve(
  __dirname,
  '../research/2026-06-23-codegraph-ecosystem/repos/cgc/tests/fixtures/sample_projects/sample_project_typescript',
);
const ROLE_DEFINITION = 0x1;
const ROLE_READ = 0x8;
const KIND_CLASS = 7;
const KIND_FUNCTION = 17;
const KIND_INTERFACE = 21;

function rmTree(dir: string): void {
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function writeProject(root: string): void {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), [
    'export function target(): string {',
    "  return 'ok';",
    '}',
    'export function caller(): string {',
    '  return target();',
    '}',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'src', 'animals.ts'), [
    'export interface Animal {',
    '  sound(): string;',
    '}',
    'export class Dog implements Animal {',
    "  sound(): string { return 'woof'; }",
    '}',
    '',
  ].join('\n'));
}

async function indexProject(root: string): Promise<void> {
  const cg = OmniWeave.initSync(root);
  await cg.indexAll();
  cg.destroy();
}

function writeScipIndex(filePath: string, language = 'typescript'): void {
  const target = 'scip-typescript npm demo 1.0 src/a.ts/target().';
  const caller = 'scip-typescript npm demo 1.0 src/a.ts/caller().';
  const animal = 'scip-typescript npm demo 1.0 src/animals.ts/Animal#';
  const dog = 'scip-typescript npm demo 1.0 src/animals.ts/Dog#';

  const index = msg(
    fieldMsg(1, msg(
      fieldMsg(2, msg(fieldString(1, 'scip-test'), fieldString(2, '1.0.0'))),
      fieldString(3, 'file:///fixture'),
      fieldVarint(4, 1),
    )),
    fieldMsg(2, document('src/a.ts', language, [
      occurrence([0, 16, 22], target, ROLE_DEFINITION),
      occurrence([3, 16, 22], caller, ROLE_DEFINITION),
      occurrence([4, 9, 15], target, ROLE_READ),
    ], [
      symbolInfo(target, KIND_FUNCTION, 'target'),
      symbolInfo(caller, KIND_FUNCTION, 'caller'),
    ])),
    fieldMsg(2, document('src/animals.ts', language, [
      occurrence([0, 17, 23], animal, ROLE_DEFINITION),
      occurrence([3, 13, 16], dog, ROLE_DEFINITION),
    ], [
      symbolInfo(animal, KIND_INTERFACE, 'Animal'),
      symbolInfo(dog, KIND_CLASS, 'Dog', [relationship(animal, { implementation: true })]),
    ])),
  );

  fs.writeFileSync(filePath, index);
}

function writeInvalidPathScipIndex(filePath: string): void {
  fs.writeFileSync(filePath, msg(
    fieldMsg(2, document('../evil.ts', 'typescript', [], [])),
  ));
}

function writeUnsupportedLanguageScipIndex(filePath: string): void {
  const symbol = 'scip-weird pkg demo 1.0 src/odd.foo/value().';
  fs.writeFileSync(filePath, msg(
    fieldMsg(2, document('src/odd.foo', 'brainfuck', [
      occurrence([0, 0, 5], symbol, ROLE_DEFINITION),
    ], [
      symbolInfo(symbol, KIND_FUNCTION, 'value'),
    ])),
  ));
}

describe('SCIP importer', () => {
  let projectRoot: string;
  let indexPath: string;

  beforeEach(async () => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-scip-project-'));
    indexPath = path.join(projectRoot, 'index.scip');
    writeProject(projectRoot);
    await indexProject(projectRoot);
    writeScipIndex(indexPath);
  });

  afterEach(() => {
    rmTree(projectRoot);
  });

  it('imports same-language references and implementation facts with SCIP provenance', async () => {
    const result = await importScipIndex(projectRoot, indexPath);

    expect(result.documentsImported).toBe(2);
    expect(result.referencesImported).toBe(1);
    expect(result.relationshipsImported).toBe(1);
    expect(result.edgesImported).toBe(2);

    const cg = OmniWeave.openSync(projectRoot);
    try {
      const caller = cg.searchNodes('caller', { limit: 5 }).find((match) => match.node.filePath === 'src/a.ts')?.node;
      const target = cg.searchNodes('target', { limit: 5 }).find((match) => match.node.filePath === 'src/a.ts')?.node;
      const dog = cg.searchNodes('Dog', { limit: 5 }).find((match) => match.node.filePath === 'src/animals.ts')?.node;
      const animal = cg.searchNodes('Animal', { limit: 5 }).find((match) => match.node.filePath === 'src/animals.ts')?.node;

      expect(caller).toBeDefined();
      expect(target).toBeDefined();
      expect(dog).toBeDefined();
      expect(animal).toBeDefined();

      const callerEdges = cg.getOutgoingEdges(caller!.id);
      expect(callerEdges).toContainEqual(expect.objectContaining({
        target: target!.id,
        kind: 'references',
        provenance: 'scip',
      }));

      const dogEdges = cg.getOutgoingEdges(dog!.id);
      expect(dogEdges).toContainEqual(expect.objectContaining({
        target: animal!.id,
        kind: 'implements',
        provenance: 'scip',
      }));
    } finally {
      cg.destroy();
    }
  });

  it('re-imports idempotently by replacing previous SCIP facts', async () => {
    await importScipIndex(projectRoot, indexPath);
    await importScipIndex(projectRoot, indexPath);

    const cg = OmniWeave.openSync(projectRoot);
    try {
      const caller = cg.searchNodes('caller', { limit: 5 }).find((match) => match.node.filePath === 'src/a.ts')!.node;
      const scipReferences = cg.getOutgoingEdges(caller.id).filter((edge) => edge.provenance === 'scip');
      expect(scipReferences).toHaveLength(1);
    } finally {
      cg.destroy();
    }
  });

  it('reports actual inserted SCIP facts when keeping existing facts', async () => {
    const first = await importScipIndex(projectRoot, indexPath, { replace: false });
    const second = await importScipIndex(projectRoot, indexPath, { replace: false });

    expect(first.deletedScipNodes).toBe(0);
    expect(first.deletedScipEdges).toBe(0);
    expect(first.edgesImported).toBe(2);
    expect(second.deletedScipNodes).toBe(0);
    expect(second.deletedScipEdges).toBe(0);
    expect(second.edgesImported).toBe(0);
  });

  it('infers empty SCIP document language from indexed files', async () => {
    writeScipIndex(indexPath, '');

    const result = await importScipIndex(projectRoot, indexPath);

    expect(result.documentsImported).toBe(2);
    expect(result.referencesImported).toBe(1);
    expect(result.relationshipsImported).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it('rejects unsafe SCIP document paths', async () => {
    writeInvalidPathScipIndex(indexPath);

    await expect(importScipIndex(projectRoot, indexPath)).rejects.toThrow(/Invalid SCIP document path/);
  });

  it('skips unsupported SCIP document languages without importing unknown facts', async () => {
    fs.writeFileSync(path.join(projectRoot, 'src', 'odd.foo'), 'value\n');
    writeUnsupportedLanguageScipIndex(indexPath);

    const result = await importScipIndex(projectRoot, indexPath);

    expect(result.documentsRead).toBe(1);
    expect(result.documentsImported).toBe(0);
    expect(result.nodesImported).toBe(0);
    expect(result.edgesImported).toBe(0);
    expect(result.warnings).toEqual([
      'Skipping SCIP document with unsupported language "brainfuck": src/odd.foo',
    ]);
  });

  it('imports through the built CLI JSON contract', () => {
    const result = spawnSync(process.execPath, [
      BIN,
      'scip',
      'import',
      indexPath,
      '--path',
      projectRoot,
      '--json',
    ], {
      cwd: projectRoot,
      encoding: 'utf-8',
      env: {
        ...process.env,
        OMNIWEAVE_NO_DAEMON: '1',
        OMNIWEAVE_NO_WATCH: '1',
      },
    });

    expect(result.status).toBe(0);
    const imported = JSON.parse(result.stdout) as ImportScipResult;
    expect(imported.documentsImported).toBe(2);
    expect(imported.referencesImported).toBe(1);
    expect(imported.relationshipsImported).toBe(1);
  });

  it.skipIf(process.env.OW_REALCORPUS !== '1')('imports a real TypeScript index.scip corpus fixture', () => {
    if (!fs.existsSync(path.join(REAL_SCIP_TYPESCRIPT_FIXTURE, 'dump.scip'))) {
      throw new Error(`Missing real SCIP fixture: ${REAL_SCIP_TYPESCRIPT_FIXTURE}`);
    }

    const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-real-scip-'));
    try {
      fs.cpSync(REAL_SCIP_TYPESCRIPT_FIXTURE, realRoot, { recursive: true });
      const init = spawnSync(process.execPath, [BIN, 'init', realRoot], {
        cwd: realRoot,
        encoding: 'utf-8',
        env: {
          ...process.env,
          OMNIWEAVE_NO_DAEMON: '1',
          OMNIWEAVE_NO_WATCH: '1',
        },
      });
      expect(init.status).toBe(0);

      const imported = spawnSync(process.execPath, [
        BIN,
        'scip',
        'import',
        path.join(realRoot, 'dump.scip'),
        '--path',
        realRoot,
        '--json',
      ], {
        cwd: realRoot,
        encoding: 'utf-8',
        env: {
          ...process.env,
          OMNIWEAVE_NO_DAEMON: '1',
          OMNIWEAVE_NO_WATCH: '1',
        },
      });

      expect(imported.status).toBe(0);
      const result = JSON.parse(imported.stdout) as ImportScipResult;
      expect(result.documentsImported).toBeGreaterThanOrEqual(10);
      expect(result.referencesImported).toBeGreaterThan(1000);
      expect(result.relationshipsImported).toBeGreaterThan(10);
      expect(result.edgesImported).toBeGreaterThan(1000);
      expect(result.warnings).toEqual([]);
    } finally {
      rmTree(realRoot);
    }
  });
});

function document(relativePath: string, language: string, occurrences: Buffer[], symbols: Buffer[]): Buffer {
  return msg(
    fieldString(1, relativePath),
    ...occurrences.map((occ) => fieldMsg(2, occ)),
    ...symbols.map((symbol) => fieldMsg(3, symbol)),
    fieldString(4, language),
    fieldVarint(6, 2),
  );
}

function occurrence(range: number[], symbol: string, roles: number): Buffer {
  return msg(
    fieldPackedInt32(1, range),
    fieldString(2, symbol),
    fieldVarint(3, roles),
  );
}

function symbolInfo(symbol: string, kind: number, displayName: string, relationships: Buffer[] = []): Buffer {
  return msg(
    fieldString(1, symbol),
    ...relationships.map((rel) => fieldMsg(4, rel)),
    fieldVarint(5, kind),
    fieldString(6, displayName),
  );
}

function relationship(symbol: string, flags: { reference?: boolean; implementation?: boolean; typeDefinition?: boolean; definition?: boolean }): Buffer {
  return msg(
    fieldString(1, symbol),
    flags.reference ? fieldBool(2, true) : Buffer.alloc(0),
    flags.implementation ? fieldBool(3, true) : Buffer.alloc(0),
    flags.typeDefinition ? fieldBool(4, true) : Buffer.alloc(0),
    flags.definition ? fieldBool(5, true) : Buffer.alloc(0),
  );
}

function msg(...fields: Buffer[]): Buffer {
  return Buffer.concat(fields);
}

function fieldMsg(fieldNumber: number, value: Buffer): Buffer {
  return Buffer.concat([key(fieldNumber, 2), varint(value.length), value]);
}

function fieldString(fieldNumber: number, value: string): Buffer {
  const bytes = Buffer.from(value, 'utf-8');
  return Buffer.concat([key(fieldNumber, 2), varint(bytes.length), bytes]);
}

function fieldPackedInt32(fieldNumber: number, values: number[]): Buffer {
  const bytes = Buffer.concat(values.map(varint));
  return Buffer.concat([key(fieldNumber, 2), varint(bytes.length), bytes]);
}

function fieldVarint(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([key(fieldNumber, 0), varint(value)]);
}

function fieldBool(fieldNumber: number, value: boolean): Buffer {
  return fieldVarint(fieldNumber, value ? 1 : 0);
}

function key(fieldNumber: number, wireType: number): Buffer {
  return varint((fieldNumber << 3) | wireType);
}

function varint(value: number): Buffer {
  const bytes: number[] = [];
  let current = value;
  while (current >= 0x80) {
    bytes.push((current & 0x7f) | 0x80);
    current = Math.floor(current / 0x80);
  }
  bytes.push(current);
  return Buffer.from(bytes);
}
