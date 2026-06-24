import type { EdgeKind } from './types';

export const CALL_SURFACE_EDGE_KIND_LIST = [
  'calls',
  'crossLang',
  'invokes',
  'instantiates',
] as const satisfies readonly EdgeKind[];

export const CALL_SURFACE_EDGE_KINDS: ReadonlySet<EdgeKind> = new Set(CALL_SURFACE_EDGE_KIND_LIST);
