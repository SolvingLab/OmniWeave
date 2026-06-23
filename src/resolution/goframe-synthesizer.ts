/**
 * GoFrame route -> controller-method dispatch synthesis.
 *
 * The reliable join is the request type: a route node is created from the
 * request struct's `g.Meta` tag, then linked to the Go method whose signature
 * takes that request type by pointer.
 */

import type { Edge, Node } from '../types';
import type { ResolutionContext } from './types';
import { GOFRAME_ROUTE_MARKER } from './frameworks/goframe';

const FANOUT_CAP = 2000;

function pointerParamTypes(sig: string): string[] {
  const out: string[] = [];
  const re = /\*\s*(?:(\w+)\.)?([A-Z]\w*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sig)) !== null) {
    if (match[1]) out.push(`${match[1]}.${match[2]}`);
    out.push(match[2]!);
  }
  return out;
}

function addonRoot(p: string): string {
  return /(?:^|\/)addons\/([^/]+)\//.exec(p)?.[1] ?? '';
}

function selectHandler(candidates: Node[], routeFile: string): Node | null {
  if (candidates.length === 1) return candidates[0]!;
  let scoped = candidates.filter((h) => /\/controller(s)?\//.test(h.filePath));
  if (scoped.length === 0) scoped = candidates;
  if (scoped.length === 1) return scoped[0]!;
  const routeAddon = addonRoot(routeFile);
  const sameAddon = scoped.filter((h) => addonRoot(h.filePath) === routeAddon);
  return sameAddon.length === 1 ? sameAddon[0]! : null;
}

export function goframeRouteEdges(ctx: ResolutionContext): Edge[] {
  const routesByReqType = new Map<string, Node[]>();
  const wanted = new Set<string>();
  for (const route of ctx.getNodesByKind('route')) {
    if (route.language !== 'go') continue;
    const marker = route.qualifiedName.indexOf(GOFRAME_ROUTE_MARKER);
    if (marker < 0) continue;
    const joinKey = route.qualifiedName.slice(marker + GOFRAME_ROUTE_MARKER.length);
    if (!joinKey) continue;
    const routes = routesByReqType.get(joinKey) ?? [];
    routes.push(route);
    routesByReqType.set(joinKey, routes);
    wanted.add(joinKey);
    const dot = joinKey.lastIndexOf('.');
    if (dot >= 0) wanted.add(joinKey.slice(dot + 1));
  }
  if (routesByReqType.size === 0) return [];

  const handlersByKey = new Map<string, Node[]>();
  for (const method of ctx.getNodesByKind('method')) {
    if (method.language !== 'go' || !method.signature) continue;
    for (const typeName of pointerParamTypes(method.signature)) {
      if (!wanted.has(typeName)) continue;
      const handlers = handlersByKey.get(typeName) ?? [];
      handlers.push(method);
      handlersByKey.set(typeName, handlers);
    }
  }

  const edges: Edge[] = [];
  const seen = new Set<string>();
  let added = 0;
  for (const [joinKey, routes] of routesByReqType) {
    const bare = joinKey.includes('.') ? joinKey.slice(joinKey.lastIndexOf('.') + 1) : joinKey;
    const candidates = handlersByKey.get(joinKey) ?? handlersByKey.get(bare);
    if (!candidates || candidates.length === 0) continue;
    for (const route of routes) {
      const handler = selectHandler(candidates, route.filePath);
      if (!handler || handler.id === route.id) continue;
      const key = `${route.id}>${handler.id}`;
      if (seen.has(key) || added >= FANOUT_CAP) continue;
      seen.add(key);
      edges.push({
        source: route.id,
        target: handler.id,
        kind: 'calls',
        line: route.startLine,
        provenance: 'heuristic',
        metadata: {
          synthesizedBy: 'goframe-route',
          route: route.name,
          requestType: bare,
          registeredAt: `${handler.filePath}:${handler.startLine}`,
        },
      });
      added++;
    }
  }
  return edges;
}
