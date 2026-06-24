/**
 * omniweave_explore relationship section.
 *
 * Relationships are supporting graph facts, not the main call path. The output
 * must rank structural edges ahead of references/imports and expose provenance
 * for synthesized edges so agents do not over-trust weak links.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import OmniWeave from '../src/index';
import { ToolHandler } from '../src/mcp/tools';
import type { Edge } from '../src/types';

interface EdgeInserter {
  queries: {
    insertEdge(edge: Edge): void;
  };
}

describe('omniweave_explore — supporting relationships', () => {
  let testDir: string;
  let cg: OmniWeave;
  let handler: ToolHandler;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniweave-explore-rel-'));
    const src = path.join(testDir, 'src');
    const scripts = path.join(testDir, 'scripts');
    const noise = path.join(testDir, 'noise');
    fs.mkdirSync(src, { recursive: true });
    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(noise, { recursive: true });

    for (let i = 0; i < 505; i++) {
      fs.writeFileSync(path.join(noise, `noise${i}.ts`), `export const noise${i} = ${i};\n`);
    }

    fs.writeFileSync(
      path.join(src, 'entry.ts'),
      `import { runWorkflow, runPythonReport, normalizeInput } from './workflow';
import type { Config } from './types';

export function entryPoint(config: Config): string {
  return runWorkflow(config) + runPythonReport(config.name) + normalizeInput(config.name);
}

export function emitDone(): string {
  return 'done';
}
`
    );
    fs.writeFileSync(
      path.join(src, 'workflow.ts'),
      `import type { Config } from './types';

export function runWorkflow(config: Config): string {
  return stepOne(config.name);
}

export function stepOne(name: string): string {
  return name.trim();
}

export function normalizeInput(name: string): string {
  return buildPayload(name.trim());
}

export function buildPayload(name: string): string {
  return sendPayload(name.toUpperCase());
}

export function sendPayload(value: string): string {
  return value;
}

export function runPythonReport(name: string): string {
  return name;
}
`
    );
    fs.writeFileSync(
      path.join(src, 'handler.ts'),
      `export function handleDone(): string {
  return 'handled';
}
`
    );
    fs.writeFileSync(
      path.join(src, 'types.ts'),
      `export interface Config {
  name: string;
}
`
    );
    fs.writeFileSync(
      path.join(scripts, 'report.py'),
      `def renderReport():
    return "report"
`
    );

    cg = OmniWeave.initSync(testDir, { config: { include: ['**/*.ts', '**/*.py'], exclude: [] } });
    await cg.indexAll();

    const emitDone = cg.getNodesByName('emitDone').find((n) => n.kind === 'function');
    const handleDone = cg.getNodesByName('handleDone').find((n) => n.kind === 'function');
    const runPythonReport = cg.getNodesByName('runPythonReport').find((n) => n.kind === 'function');
    const renderReport = cg.getNodesByName('renderReport').find((n) => n.kind === 'function');
    expect(emitDone).toBeTruthy();
    expect(handleDone).toBeTruthy();
    expect(runPythonReport).toBeTruthy();
    expect(renderReport).toBeTruthy();
    (cg as unknown as EdgeInserter).queries.insertEdge({
      source: emitDone!.id,
      target: handleDone!.id,
      kind: 'calls',
      line: 8,
      provenance: 'heuristic',
      metadata: {
        synthesizedBy: 'event-emitter',
        event: 'done',
        registeredAt: 'src/wiring.ts:12',
        confidence: 0.75,
      },
    });
    (cg as unknown as EdgeInserter).queries.insertEdge({
      source: runPythonReport!.id,
      target: renderReport!.id,
      kind: 'crossLang',
      line: 9,
      provenance: 'heuristic',
      metadata: {
        synthesizedBy: 'general-crosslang',
        confidence: 0.9,
      },
    });

    handler = new ToolHandler(cg);
  });

  afterEach(() => {
    if (cg) cg.destroy();
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('labels relationships as supporting facts and ranks structural edges first', async () => {
    const result = await handler.execute('omniweave_explore', {
      query: 'entryPoint runWorkflow stepOne Config emitDone handleDone',
      maxFiles: 8,
    });
    const text = result.content[0].text;

    expect(text).toContain('### Supporting relationships (not necessarily the call path)');
    expect(text).not.toContain('### Relationships');

    const sourceIndex = text.indexOf('### Source Code');
    const relationshipsIndex = text.indexOf('### Supporting relationships');
    expect(sourceIndex).toBeGreaterThan(-1);
    expect(relationshipsIndex).toBeGreaterThan(-1);
    expect(sourceIndex).toBeLessThan(relationshipsIndex);

    const callsIndex = text.indexOf('**calls:**');
    const referencesIndex = text.indexOf('**references:**');
    const importsIndex = text.indexOf('**imports:**');
    expect(callsIndex).toBeGreaterThan(-1);
    if (referencesIndex >= 0) expect(callsIndex).toBeLessThan(referencesIndex);
    if (importsIndex >= 0) expect(callsIndex).toBeLessThan(importsIndex);

    expect(text).toMatch(
      /emitDone → handleDone\s+\[src\/entry\.ts:8; dynamic: event `done` @src\/wiring\.ts:12; confidence 0\.75\]/
    );
  });

  it('uses cross-language call-surface edges in the primary flow', async () => {
    const result = await handler.execute('omniweave_explore', {
      query: 'entryPoint runPythonReport renderReport',
      maxFiles: 8,
    });
    const text = result.content[0].text;

    expect(text).toContain('## Flow (call path among the symbols you queried)');
    expect(text).toMatch(/1\. entryPoint[\s\S]*2\. runPythonReport[\s\S]*3\. renderReport/);
    expect(text).toContain('dynamic: general crosslang');
  });

  it('bridges endpoint-only flow queries across two unnamed intermediates', async () => {
    const result = await handler.execute('omniweave_explore', {
      query: 'entryPoint sendPayload',
      maxFiles: 8,
    });
    const text = result.content[0].text;

    expect(text).toContain('## Flow (call path among the symbols you queried)');
    expect(text).toMatch(/1\. entryPoint[\s\S]*2\. normalizeInput[\s\S]*3\. buildPayload[\s\S]*4\. sendPayload/);
  });

  it('labels framework synthesized call-path hops by their real dispatch family', async () => {
    const runWorkflow = cg.getNodesByName('runWorkflow').find((n) => n.kind === 'function');
    const emitDone = cg.getNodesByName('emitDone').find((n) => n.kind === 'function');
    const handleDone = cg.getNodesByName('handleDone').find((n) => n.kind === 'function');
    expect(runWorkflow).toBeTruthy();
    expect(emitDone).toBeTruthy();
    expect(handleDone).toBeTruthy();

    (cg as unknown as EdgeInserter).queries.insertEdge({
      source: runWorkflow!.id,
      target: emitDone!.id,
      kind: 'calls',
      line: 4,
      provenance: 'heuristic',
      metadata: {
        synthesizedBy: 'sidekiq-dispatch',
        via: 'DestroyUserWorker',
        registeredAt: 'app/jobs/destroy_user_worker.rb:12',
        confidence: 0.85,
      },
    });

    const text = await cg.buildContext('runWorkflow emitDone handleDone', {
      format: 'markdown',
      includeCode: false,
    }) as string;

    expect(text).toContain('## Call paths');
    expect(text).toMatch(/runWorkflow\s+.\[Sidekiq job `DestroyUserWorker` @app\/jobs\/destroy_user_worker\.rb:12\]\s+emitDone/);
    expect(text).toContain('callback/framework');
    expect(text).not.toContain('event  @app/jobs/destroy_user_worker.rb:12');
  });
});
