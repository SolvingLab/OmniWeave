import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { OmniWeave } from '../src';
import type { Edge } from '../src/types';

/**
 * RTK Query generated-hook → endpoint synthesizer (the 8th and last CG-only dispatch
 * synthesizer, closing the iron-law-6 framework debt). RTK Query generates one
 * `useGetXQuery`/`useUpdateYMutation` hook per endpoint defined in
 * `createApi({ endpoints: b => ({ getX: b.query(...) }) })`. The hook↔endpoint link is a
 * pure naming convention with no static edge. Closing it needs BOTH halves of extraction —
 * the generated-hook bindings (`extractRtkHookBindings`, sentinel signature) AND the
 * endpoints as function nodes (`extractRtkEndpoints`) — plus the synthesizer that bridges
 * `useGetXQuery → getX` by deriving the endpoint key from the hook name.
 */
describe('RTK Query generated-hook → endpoint synthesizer', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-query-fixture-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const bridge = (edges: Edge[], targetId: string): Edge | undefined =>
    edges.find(
      (e) =>
        e.target === targetId &&
        e.kind === 'calls' &&
        e.provenance === 'heuristic' &&
        (e.metadata as { synthesizedBy?: string } | undefined)?.synthesizedBy === 'rtk-query'
    );

  it('extracts createApi endpoints + generated hooks and bridges each hook to its endpoint', async () => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'api.ts'),
      `import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const recordsApi = createApi({
  reducerPath: 'recordsApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  endpoints: (builder) => ({
    getRecords: builder.query({
      query: () => 'records',
    }),
    addRecord: builder.mutation({
      query: (body) => ({ url: 'records', method: 'POST', body }),
    }),
  }),
});

export const { useGetRecordsQuery, useAddRecordMutation } = recordsApi;
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const fns = cg.getNodesByKind('function');
    // Both halves of extraction must be present.
    const getRecords = fns.find((n) => n.name === 'getRecords');
    const addRecord = fns.find((n) => n.name === 'addRecord');
    const useGetRecords = fns.find((n) => n.name === 'useGetRecordsQuery');
    const useAddRecord = fns.find((n) => n.name === 'useAddRecordMutation');
    expect(getRecords).toBeDefined();
    expect(addRecord).toBeDefined();
    expect(useGetRecords).toBeDefined();
    expect(useAddRecord).toBeDefined();
    // The hooks carry the sentinel signature so the synthesizer (not a hand-written hook).
    expect(useGetRecords!.signature).toBe('= RTK Query generated hook');

    const qEdge = bridge(cg.getOutgoingEdges(useGetRecords!.id), getRecords!.id);
    const mEdge = bridge(cg.getOutgoingEdges(useAddRecord!.id), addRecord!.id);
    expect(qEdge).toBeDefined();
    expect(mEdge).toBeDefined();
    expect((qEdge!.metadata as { confidence?: number }).confidence).toBe(0.8);
    expect((qEdge!.metadata as { via?: string }).via).toBe('getRecords');
  });

  it('does not mint hook nodes for a hand-written useFooQuery (not destructured off an api)', async () => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'hooks.ts'),
      `export function useFooQuery() {
  return { data: null };
}
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const hook = cg.getNodesByKind('function').find((n) => n.name === 'useFooQuery');
    expect(hook).toBeDefined();
    // A real hand-written hook is a normal function, NOT the sentinel binding.
    expect(hook!.signature).not.toBe('= RTK Query generated hook');
    const synthesized = cg
      .getOutgoingEdges(hook!.id)
      .filter((e) => (e.metadata as { synthesizedBy?: string } | undefined)?.synthesizedBy === 'rtk-query');
    expect(synthesized).toHaveLength(0);
  });
});
