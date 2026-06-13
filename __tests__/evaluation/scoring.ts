import type { EvalResult } from './types.js';

export const PASS_THRESHOLD = 0.5;

export function scoreSearchNodes(
  caseId: string,
  expectedSymbols: string[],
  results: Array<{ node: { name: string }; score: number }>,
  latencyMs: number
): EvalResult {
  const expectedLower = expectedSymbols.map((s) => s.toLowerCase());
  const resultNames = results.map((r) => r.node.name.toLowerCase());

  const found: string[] = [];
  const missed: string[] = [];
  let firstRank = 0;

  for (let i = 0; i < expectedLower.length; i++) {
    const idx = resultNames.indexOf(expectedLower[i]);
    if (idx !== -1) {
      found.push(expectedSymbols[i]);
      if (firstRank === 0) firstRank = idx + 1;
    } else {
      missed.push(expectedSymbols[i]);
    }
  }

  const recall = expectedSymbols.length > 0 ? found.length / expectedSymbols.length : 0;
  const mrr = firstRank > 0 ? 1 / firstRank : 0;

  return {
    caseId,
    pass: recall >= PASS_THRESHOLD,
    recall,
    mrr,
    foundSymbols: found,
    missedSymbols: missed,
    latencyMs,
  };
}

/**
 * Score a graph-shape assertion: a relationship is present in sufficient
 * quantity (e.g. "the DESeqDataSet S4 class owns ≥8 `contains` edges to its
 * dispatched methods"). Unlike search/context scoring this asserts on the EDGE
 * graph, so it is the gate that proves the S4 dispatch graph exists at all —
 * red at baseline 0, green once the dispatch edges are synthesized. Recall is
 * binary: the relationship meets the bar or it doesn't.
 */
export function scoreAssertEdges(
  caseId: string,
  symbolName: string,
  actualCount: number,
  minEdgeCount: number,
  latencyMs: number,
  maxEdgeCount: number = Infinity
): EvalResult {
  const pass = actualCount >= minEdgeCount && actualCount <= maxEdgeCount;
  const bound = actualCount > maxEdgeCount ? `≤${maxEdgeCount}` : `≥${minEdgeCount}`;
  return {
    caseId,
    pass,
    recall: pass ? 1 : 0,
    mrr: 0,
    foundSymbols: pass ? [symbolName] : [],
    missedSymbols: pass ? [] : [`${symbolName} (${actualCount} edges, want ${bound})`],
    edgeCount: actualCount,
    latencyMs,
  };
}

/**
 * Score a path-composition assertion: target node B is reachable from source
 * node A within `maxHops`, following only the allowed edge kinds. Where
 * scoreAssertEdges proves each hop exists in isolation, this proves they
 * COMPOSE — the crossLang target file being the very node that contains the S4
 * method, so an agent can actually walk workflow step → script → dispatch
 * target. Recall is binary (a path within budget exists or it doesn't); the
 * shortest hop count is surfaced in `edgeCount` for diagnostics.
 *
 * @param pathHops shortest path length in hops (edges), or null if unreachable
 */
export function scoreAssertReachable(
  caseId: string,
  fromName: string,
  toName: string,
  pathHops: number | null,
  maxHops: number,
  latencyMs: number,
  fromCount = -1,
  toCount = -1
): EvalResult {
  const pass = pathHops !== null && pathHops <= maxHops;
  // A FAIL stays a FAIL whether the endpoints are missing or merely unconnected —
  // an absent target node (e.g. the S4 method `toKind` requires has regressed
  // away) MUST go red, that is the gate's whole point. But distinguish the cause
  // in the message so a typo/wrong-corpus run is debuggable, not mistaken for a
  // real reachability regression.
  const noCandidates = fromCount === 0 || toCount === 0;
  const reason =
    pathHops === null
      ? noCandidates
        ? `${fromName}(${fromCount} nodes) → ${toName}(${toCount} nodes) — no candidate endpoints (corpus / name / toKind mismatch, or the node regressed away)`
        : `${fromName} → ${toName} (unreachable)`
      : `${fromName} → ${toName} (${pathHops} hops > ${maxHops} max)`;
  return {
    caseId,
    pass,
    recall: pass ? 1 : 0,
    mrr: 0,
    foundSymbols: pass ? [`${fromName} → ${toName} (${pathHops} hops)`] : [],
    missedSymbols: pass ? [] : [reason],
    edgeCount: pathHops ?? 0,
    latencyMs,
  };
}

export function scoreFindRelevantContext(
  caseId: string,
  expectedSymbols: string[],
  subgraph: { nodes: Map<string, { name: string }>; edges: unknown[]; roots: string[] },
  latencyMs: number
): EvalResult {
  const expectedLower = new Set(expectedSymbols.map((s) => s.toLowerCase()));
  const nodeNames = new Set<string>();
  for (const node of subgraph.nodes.values()) {
    nodeNames.add(node.name.toLowerCase());
  }

  const found: string[] = [];
  const missed: string[] = [];

  for (const sym of expectedSymbols) {
    if (nodeNames.has(sym.toLowerCase())) {
      found.push(sym);
    } else {
      missed.push(sym);
    }
  }

  const recall = expectedSymbols.length > 0 ? found.length / expectedSymbols.length : 0;
  const nodeCount = subgraph.nodes.size;
  const edgeCount = subgraph.edges.length;
  const edgeDensity = nodeCount > 0 ? edgeCount / nodeCount : 0;

  return {
    caseId,
    pass: recall >= PASS_THRESHOLD,
    recall,
    mrr: 0,
    foundSymbols: found,
    missedSymbols: missed,
    nodeCount,
    edgeCount,
    edgeDensity,
    latencyMs,
  };
}
