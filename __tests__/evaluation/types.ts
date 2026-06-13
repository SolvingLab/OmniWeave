import type { EdgeKind, NodeKind } from '../../src/types.js';

export interface EvalTestCase {
  id: string;
  query: string;
  api: 'searchNodes' | 'findRelevantContext' | 'assertEdges' | 'assertReachable';
  expectedSymbols: string[];
  kinds?: NodeKind[];
  options?: Record<string, unknown>;
  /**
   * Which indexed corpus this case runs against. The runner loads ONE database,
   * so each case is tagged with the corpus it expects; the runner filters to the
   * selected corpus (`EVAL_CORPUS`, default 'elasticsearch'). Untagged cases
   * default to 'elasticsearch' so the existing Java suite keeps running as-is.
   */
  corpus?: string;

  // --- assertEdges: relationship-shape assertion (graph edges, not search) ---
  /** The symbol whose edges are counted (all nodes with this name aggregate). */
  symbolName?: string;
  /**
   * Restrict the counted nodes to this kind. When a name is BOTH an S4 generic
   * (a `function` node, qn === name) and its dispatched `method` (qn `Class::name`),
   * this pins the assertion to one — e.g. assert the S4 generic call resolves to the
   * GENERIC (function), not misfire onto the `method` node (which must stay 0).
   */
  symbolKind?: NodeKind;
  /** Edge kind to count on that symbol's node(s). */
  edgeKind?: EdgeKind;
  /**
   * Only count edges whose `metadata.confidence` is at least this. Gates a
   * confidence-CALIBRATION fix where the TARGET is already correct but under-confident
   * — e.g. an R class+constructor call resolves to the constructor function, but at the
   * proximity floor 0.4 until the bare-call router lifts it to 0.9. An edge with no
   * confidence is excluded when this is set.
   */
  minConfidence?: number;
  /** Whether to count edges pointing at the symbol or leaving it. */
  direction?: 'incoming' | 'outgoing';
  /** Minimum matching-edge count for the case to pass. */
  minEdgeCount?: number;
  /**
   * Maximum matching-edge count for the case to pass (default: unbounded). Set to
   * 0 (with minEdgeCount 0) to gate a PRECISION NEGATIVE — a symbol that must NOT
   * grow a given edge, e.g. a function that only `echo`s an interpreter+path string
   * must never mint a crossLang edge. Without this a synthesizer could over-link
   * freely and every positive gate would still pass.
   */
  maxEdgeCount?: number;

  // --- assertReachable: path-composition assertion (proves the polyglot chain) ---
  // assertEdges proves each hop EXISTS; it cannot prove the hops share nodes into
  // ONE connected path (a crossLang edge landing in a different file than the one
  // owning the S4 class would leave every per-hop assertEdges green). This variant
  // asserts node `toName` is reachable from `fromName` within `maxHops`, following
  // only `reachableVia` edges — the gate that locks the §1.5 differentiator
  // (workflow step → script file → S4 method) as a navigable whole.
  /** Source node name (all nodes with this name are tried as path origins). */
  fromName?: string;
  /** Target node name (all nodes with this name are tried as path destinations). */
  toName?: string;
  /** Restrict path destinations to this node kind (e.g. 'method' to require the
   *  S4 dispatch target specifically, not a same-named generic function). */
  toKind?: NodeKind;
  /** Maximum hop count (path edge count) for the case to pass. */
  maxHops?: number;
  /** Edge kinds the path may traverse (all kinds if omitted). */
  reachableVia?: EdgeKind[];
}

export interface EvalResult {
  caseId: string;
  pass: boolean;
  recall: number;
  mrr: number;
  foundSymbols: string[];
  missedSymbols: string[];
  nodeCount?: number;
  edgeCount?: number;
  edgeDensity?: number;
  latencyMs: number;
}

export interface EvalReport {
  timestamp: string;
  codebasePath: string;
  codegraphSha: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    meanRecall: number;
    meanMRR: number;
  };
  results: EvalResult[];
}
