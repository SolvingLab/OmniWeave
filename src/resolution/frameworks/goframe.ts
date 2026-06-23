/**
 * GoFrame route metadata resolver.
 *
 * GoFrame's standard router binds routes reflectively. The path/method lives on
 * a request type's embedded `g.Meta` tag, while the serving controller method is
 * joined at runtime through the request type in the handler signature.
 */

import type { Node } from '../../types';
import type { FrameworkResolver, ResolvedRef, ResolutionContext, UnresolvedRef } from '../types';
import { stripCommentsForRegex } from '../strip-comments';

const GOFRAME_META_RE = /\btype\s+([A-Z]\w*)\s+struct\s*\{\s*g\.Meta\s+`([^`]*)`/g;
const META_PATH_RE = /\bpath:"([^"]+)"/;
const META_METHOD_RE = /\bmethod:"([^"]+)"/;
const GO_PACKAGE_RE = /^\s*package\s+(\w+)/m;

export const GOFRAME_ROUTE_MARKER = '::goframe-route:';

export const goframeResolver: FrameworkResolver = {
  name: 'goframe',
  languages: ['go'],

  detect(context: ResolutionContext): boolean {
    const goMod = context.readFile('go.mod');
    return !!goMod && goMod.includes('github.com/gogf/gf');
  },

  extract(filePath, content) {
    if (!filePath.endsWith('.go') || !content.includes('g.Meta')) {
      return { nodes: [], references: [] };
    }

    const nodes: Node[] = [];
    const now = Date.now();
    const safe = stripCommentsForRegex(content, 'go');
    const pkg = GO_PACKAGE_RE.exec(safe)?.[1];

    GOFRAME_META_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = GOFRAME_META_RE.exec(safe)) !== null) {
      const [, requestType, tag] = match;
      const pathMatch = META_PATH_RE.exec(tag!);
      if (!pathMatch) continue;
      const routePath = pathMatch[1]!;
      const methodMatch = META_METHOD_RE.exec(tag!);
      const method = methodMatch ? methodMatch[1]!.toUpperCase() : 'ANY';
      const line = safe.slice(0, match.index).split('\n').length;
      const joinKey = pkg ? `${pkg}.${requestType}` : requestType!;

      nodes.push({
        id: `route:${filePath}:${line}:${method}:${routePath}`,
        kind: 'route',
        name: `${method} ${routePath}`,
        qualifiedName: `${filePath}${GOFRAME_ROUTE_MARKER}${joinKey}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'go',
        updatedAt: now,
      });
    }

    return { nodes, references: [] };
  },

  resolve(_ref: UnresolvedRef, _context: ResolutionContext): ResolvedRef | null {
    return null;
  },
};
