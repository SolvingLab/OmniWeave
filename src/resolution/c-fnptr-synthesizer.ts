/**
 * C/C++ function-pointer dispatch synthesis.
 *
 * C/C++ polymorphism is the function pointer: a struct carries a fn-pointer
 * field (`int (*fn)(int)`, or a fn-pointer-typedef field `hook_func func`),
 * concrete functions are *registered* into it through a table
 * (`static struct cmd cmds[] = {{"add", cmd_add}, …}`, a designated
 * `.fn = cmd_add`, or a direct `x->fn = cmd_add` assignment), and the dispatcher calls through it
 * indirectly (`p->fn(argv)`). Static extraction captures neither the
 * registration→field binding nor the indirect call, so the dispatcher→handler
 * edge is missing and `git`'s `run_builtin` looks like it calls nothing, the
 * hooks in `hook_demo.c` are unreachable, etc.
 *
 * This bridges it, keyed by **(visible struct definition, fn-pointer field)**:
 *   • registrations — a function bound to `S.field` via a positional
 *     initializer (matched by field index), a designated `.field = fn`, or a
 *     direct `x.field = fn` / `x->field = fn` assignment;
 *   • dispatch — `recv->field(…)` / `recv.field(…)` where `recv` resolves to a
 *     value of struct type `S` (from the enclosing function's params / locals),
 *     falling back to the field name when it is unique to one struct;
 *   • field←field propagation — `a->f = b->g` merges `B.g`'s handlers into
 *     `A.f`, so a generic single-slot hook that is reassigned from a registry
 *     (the `hook_demo.c` shape: `h->func = found->fn`) still resolves.
 *
 * Whole-graph pass after base resolution; all edges are `provenance:'heuristic'`
 * (`synthesizedBy:'fn-pointer-dispatch'`) with a `confidence` per OmniWeave's
 * trust model. High precision via the (type, field) key + a real-function gate;
 * a project with no fn-pointer dispatch is a no-op.
 */
import type { Edge, Node } from '../types';
import type { QueryBuilder } from '../db/queries';
import type { ResolutionContext } from './types';
import { stripCommentsForRegex } from './strip-comments';
import * as path from 'node:path';

const C_CPP_EXT = /\.(c|h|cc|cpp|cxx|hpp|hh|hxx|cppm|ipp|inl|tcc)$/i;
const FN_KINDS = new Set(['function', 'method']);
const FANOUT_CAP = 300; // a real command table (git ~150) is legitimate fan-out; this only stops pathological cases.

/** A struct field, in declaration order, flagged when it is a function pointer. */
interface FieldInfo {
  name: string;
  index: number;
  isFnPtr: boolean;
}

interface StructLayout {
  name: string;
  filePath: string;
  fields: FieldInfo[];
}

type StructKey = string;

function sliceLines(content: string, startLine?: number, endLine?: number): string {
  if (!startLine) return '';
  return content.split('\n').slice(startLine - 1, endLine ?? startLine).join('\n');
}

function lineAt(content: string, index: number, startLine = 1): number {
  return startLine + content.slice(0, index).split('\n').length - 1;
}

function blankStringLiterals(src: string): string {
  const chars = [...src];
  for (let i = 0; i < chars.length; i++) {
    const quote = chars[i];
    if (quote !== '"' && quote !== "'") continue;
    chars[i] = ' ';
    i++;
    while (i < chars.length) {
      const c = chars[i];
      if (c === '\n') break;
      chars[i] = ' ';
      if (c === '\\') {
        i++;
        if (i < chars.length && chars[i] !== '\n') chars[i] = ' ';
      } else if (c === quote) {
        break;
      }
      i++;
    }
  }
  return chars.join('');
}

function projectPathJoin(fromFile: string, includePath: string): string {
  const base = path.posix.dirname(fromFile);
  const joined = base === '.' ? includePath : path.posix.join(base, includePath);
  return path.posix.normalize(joined).replace(/^\.\//, '');
}

/** Index of the `}` matching the `{` at `open` (which must point at a `{`). -1 if unbalanced. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split `body` on `sep` at brace/paren/bracket depth 0 (commas inside `{…}` / `(…)` stay together). */
function splitTopLevel(body: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === sep && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out;
}

/** A fn-pointer field looks like `… (*name)(…)` — capture `name`. */
const FNPTR_DECL_RE = /\(\s*\*\s*(\w+)\s*\)\s*\(/;
/** `typedef RET (*NAME)(…)` — a function-pointer typedef. */
const FNPTR_TYPEDEF_RE = /\btypedef\b[^;{}]*?\(\s*\*\s*(\w+)\s*\)\s*\(/g;

export function cFnPointerDispatchEdges(queries: QueryBuilder, ctx: ResolutionContext): Edge[] {
  const files = ctx.getAllFiles().filter((f) => C_CPP_EXT.test(f));
  if (files.length === 0) return [];
  const fileSet = new Set(files);

  // Cache stripped/masked source per file (read once, reused across passes).
  const rawCache = new Map<string, string | null>();
  const commentStrippedCache = new Map<string, string>();
  const srcCache = new Map<string, string>();
  const raw = (file: string): string | null => {
    if (rawCache.has(file)) return rawCache.get(file)!;
    const content = ctx.readFile(file);
    rawCache.set(file, content);
    return content;
  };
  const commentStripped = (file: string): string | null => {
    if (commentStrippedCache.has(file)) return commentStrippedCache.get(file)!;
    const content = raw(file);
    if (content == null) return null;
    const stripped = stripCommentsForRegex(content, 'c');
    commentStrippedCache.set(file, stripped);
    return stripped;
  };
  const src = (file: string): string | null => {
    if (srcCache.has(file)) return srcCache.get(file)!;
    const stripped = commentStripped(file);
    const s = stripped == null ? '' : blankStringLiterals(stripped);
    srcCache.set(file, s);
    return stripped == null ? null : s;
  };
  const includeCache = new Map<string, Set<string>>();
  const includesFor = (file: string): Set<string> => {
    const cached = includeCache.get(file);
    if (cached) return cached;
    const includes = new Set<string>();
    const s = commentStripped(file);
    if (s) {
      const includeRe = /^\s*#\s*include\s*"([^"]+)"/gm;
      let m: RegExpExecArray | null;
      while ((m = includeRe.exec(s))) {
        const includePath = m[1]!;
        const candidates = [
          projectPathJoin(file, includePath),
          includePath.replace(/^\.\//, ''),
        ];
        let resolved = candidates.find((candidate) => fileSet.has(candidate));
        if (!resolved) {
          const basename = path.posix.basename(includePath);
          const matches = files.filter((candidate) => path.posix.basename(candidate) === basename);
          if (matches.length === 1) resolved = matches[0]!;
        }
        if (resolved) includes.add(resolved);
      }
    }
    includeCache.set(file, includes);
    return includes;
  };

  // ---- Pass A: function-pointer typedefs (cross-file) ----
  const fnPtrTypedefs = new Set<string>();
  for (const file of files) {
    const s = src(file);
    if (!s || !s.includes('typedef')) continue;
    FNPTR_TYPEDEF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FNPTR_TYPEDEF_RE.exec(s))) fnPtrTypedefs.add(m[1]!);
  }

  // ---- Pass B: struct field layouts ----
  const structKeyFor = (st: Pick<Node, 'filePath' | 'name'>): StructKey => `${st.filePath}\0${st.name}`;
  const slotKey = (struct: StructKey, field: string): string => `${struct}\0${field}`;
  const slotLabel = (struct: StructKey, field: string): string => `${structLayout.get(struct)?.name ?? struct}.${field}`;

  // structLayout: struct definition key → ordered fields (with fn-pointer flag).
  // fieldToStructs: fn-pointer field name → set of struct definition keys that declare it.
  const structLayout = new Map<StructKey, StructLayout>();
  const structKeysByName = new Map<string, Set<StructKey>>();
  const fieldToStructs = new Map<string, Set<StructKey>>();
  for (const st of ctx.getNodesByKind('struct')) {
    if (!C_CPP_EXT.test(st.filePath)) continue;
    const s = srcCache.get(st.filePath) ?? src(st.filePath);
    if (!s) continue;
    const body = sliceLines(s, st.startLine, st.endLine);
    const open = body.indexOf('{');
    const close = open >= 0 ? matchBrace(body, open) : -1;
    if (open < 0 || close < 0) continue;
    const inner = body.slice(open + 1, close);
    const fields: FieldInfo[] = [];
    let idx = 0;
    for (const rawDecl of splitTopLevel(inner, ';')) {
      const decl = rawDecl.trim();
      if (!decl) continue;
      let name: string | null = null;
      let isFnPtr = false;
      const ptr = decl.match(FNPTR_DECL_RE);
      if (ptr) {
        name = ptr[1]!;
        isFnPtr = true;
      } else {
        // `TYPE [*]name` — fn-pointer when TYPE is a fn-pointer typedef.
        const fm = decl.match(/(\w+)\s+\*?\s*(\w+)\s*$/);
        if (fm) {
          name = fm[2]!;
          isFnPtr = fnPtrTypedefs.has(fm[1]!);
        }
      }
      if (!name) continue;
      fields.push({ name, index: idx, isFnPtr });
      if (isFnPtr) {
        if (!fieldToStructs.has(name)) fieldToStructs.set(name, new Set());
        fieldToStructs.get(name)!.add(structKeyFor(st));
      }
      idx++;
    }
    if (fields.some((f) => f.isFnPtr)) {
      const key = structKeyFor(st);
      structLayout.set(key, { name: st.name, filePath: st.filePath, fields });
      if (!structKeysByName.has(st.name)) structKeysByName.set(st.name, new Set());
      structKeysByName.get(st.name)!.add(key);
    }
  }
  if (structLayout.size === 0) return [];

  const isStructVisible = (fromFile: string, struct: StructKey): boolean => {
    const layout = structLayout.get(struct);
    return !!layout && (layout.filePath === fromFile || includesFor(fromFile).has(layout.filePath));
  };

  const resolveStructKey = (fromFile: string, name: string, allowed?: Set<StructKey>): StructKey | null => {
    const keys = [...(structKeysByName.get(name) ?? [])].filter((key) =>
      (!allowed || allowed.has(key)) && isStructVisible(fromFile, key)
    );
    return keys.length === 1 ? keys[0]! : null;
  };

  const fnPtrFieldOf = (struct: StructKey, field: string): boolean =>
    !!structLayout.get(struct)?.fields.some((f) => f.name === field && f.isFnPtr);

  // C/C++ function + method nodes, materialized once (bounded by C/C++ files).
  const cFns: Node[] = [];
  for (const fn of iterateFns(queries)) {
    if (C_CPP_EXT.test(fn.filePath)) cFns.push(fn);
  }

  // ---- function-name → node resolution (prefer a function in the same file) ----
  const resolveFn = (name: string, preferFile?: string): Node | null => {
    const cands = ctx.getNodesByName(name).filter((n) => FN_KINDS.has(n.kind));
    if (cands.length === 0) return null;
    if (cands.length === 1) return cands[0]!;
    if (preferFile) {
      const same = cands.find((n) => n.filePath === preferFile);
      if (same) return same;
    }
    return cands[0]!;
  };

  // ---- Pass C: registrations — Map<"structKey.field", Map<funcNodeId, registeredAt>> ----
  const reg = new Map<string, Map<string, string>>();
  const idToNode = new Map<string, Node>();
  const addReg = (struct: StructKey, field: string, fn: Node, registeredAt: string): void => {
    const key = slotKey(struct, field);
    if (!reg.has(key)) reg.set(key, new Map());
    reg.get(key)!.set(fn.id, registeredAt);
    idToNode.set(fn.id, fn);
  };

  // A struct value `{ … }` (one element) — register its function entries to the
  // struct's fields, by `.field = fn` designators or by positional slot.
  const registerStructValue = (struct: StructKey, valueBody: string, file: string, registeredAt: string): void => {
    const layout = structLayout.get(struct);
    if (!layout) return;
    const items = splitTopLevel(valueBody, ',');
    let pos = 0;
    for (const rawItem of items) {
      const item = rawItem.trim();
      if (!item) continue;
      const des = item.match(/^\.\s*(\w+)\s*=\s*(?:&\s*)?(\w+)\s*$/);
      if (des) {
        const field = des[1]!;
        if (fnPtrFieldOf(struct, field)) {
          const fn = resolveFn(des[2]!, file);
          if (fn) addReg(struct, field, fn, registeredAt);
        }
        // a designated item does not advance positional counting
        continue;
      }
      const field = layout.fields.find((f) => f.index === pos);
      if (field?.isFnPtr) {
        const id = item.match(/^&?\s*(\w+)\s*$/);
        if (id) {
          const fn = resolveFn(id[1]!, file);
          if (fn) addReg(struct, field.name, fn, registeredAt);
        }
      }
      pos++;
    }
  };

  // `(?:struct )?TYPE name[opt] = {` initializers, where TYPE is a struct that
  // has ≥1 fn-pointer field. Handles both single (`= {…}`) and array
  // (`[] = { {…}, {…} }`) forms.
  const INIT_RE =
    /(?:^|[;{}])\s*(?:(?:static|const|extern|register|volatile)\s+)*(?:struct\s+)?(\w+)\s+(\w+)\s*(\[[^\]]*\])?\s*=\s*\{/g;
  for (const file of files) {
    const s = srcCache.get(file);
    if (!s || !s.includes('=')) continue;
    INIT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INIT_RE.exec(s))) {
      const struct = resolveStructKey(file, m[1]!);
      if (!struct) continue;
      const isArray = !!m[3];
      const open = m.index + m[0].length - 1; // points at the `{`
      const close = matchBrace(s, open);
      if (close < 0) continue;
      const body = s.slice(open + 1, close);
      const registeredAt = `${file}:${lineAt(s, open)}`;
      if (isArray) {
        // top-level `{ … }` element groups
        for (const el of splitTopLevel(body, ',')) {
          const t = el.trim();
          if (t.startsWith('{')) {
            const e = matchBrace(t, 0);
            if (e > 0) registerStructValue(struct, t.slice(1, e), file, registeredAt);
          } else if (t) {
            // array of bare values (rare for structs) — treat as one positional slot
            registerStructValue(struct, t, file, registeredAt);
          }
        }
      } else {
        registerStructValue(struct, body, file, registeredAt);
      }
      INIT_RE.lastIndex = close;
    }
  }

  // ---- receiver-type resolution within a function's source ----
  // `(?:struct )?TYPE [*]recv` declared in the params or body → TYPE (if a known struct).
  const recvTypeIn = (file: string, fnSrc: string, recv: string): StructKey | null => {
    const re = new RegExp(`(?:struct\\s+)?(\\w+)\\s*\\*?\\s*\\b${recv}\\b\\s*(?:[,)=;]|\\[)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(fnSrc))) {
      const struct = resolveStructKey(file, m[1]!);
      if (struct) return struct;
    }
    return null;
  };

  // ---- Pass D: direct function assignments (`a->f = handler`) ----
  const FN_ASSIGN_RE = /(\w+)\s*(?:->|\.)\s*(\w+)\s*=\s*(?:&\s*)?(\w+)\s*(?:;|,|\))/g;
  for (const fn of cFns) {
    const s = srcCache.get(fn.filePath);
    if (!s) continue;
    const body = sliceLines(s, fn.startLine, fn.endLine);
    if (!body.includes('=')) continue;
    FN_ASSIGN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FN_ASSIGN_RE.exec(body))) {
      const [, recv, field, targetName] = m;
      const struct = recvTypeIn(fn.filePath, body, recv!);
      if (!struct || !fnPtrFieldOf(struct, field!)) continue;
      const target = resolveFn(targetName!, fn.filePath);
      if (target) addReg(struct, field!, target, `${fn.filePath}:${lineAt(body, m.index, fn.startLine)}`);
    }
  }

  // ---- Pass E: field←field propagation (`a->f = b->g`) ----
  // Collected as (targetStruct.field ← sourceStruct.field) pairs, then merged to
  // a fixpoint so a hook slot inherits a registry field's handlers.
  const FIELD_ASSIGN_RE = /(\w+)\s*(?:->|\.)\s*(\w+)\s*=\s*(\w+)\s*(?:->|\.)\s*(\w+)/g;
  const propagations: { to: string; from: string }[] = [];
  for (const fn of cFns) {
    const s = srcCache.get(fn.filePath);
    if (!s) continue;
    const body = sliceLines(s, fn.startLine, fn.endLine);
    if (!body.includes('=')) continue;
    FIELD_ASSIGN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FIELD_ASSIGN_RE.exec(body))) {
      const [, lrecv, lfield, rrecv, rfield] = m;
      const lt = recvTypeIn(fn.filePath, body, lrecv!);
      const rt = recvTypeIn(fn.filePath, body, rrecv!);
      if (lt && rt && fnPtrFieldOf(lt, lfield!) && fnPtrFieldOf(rt, rfield!)) {
        propagations.push({ to: slotKey(lt, lfield!), from: slotKey(rt, rfield!) });
      }
    }
  }
  for (let pass = 0; pass < 3 && propagations.length; pass++) {
    let changed = false;
    for (const { to, from } of propagations) {
      const fromRegs = reg.get(from);
      if (!fromRegs) continue;
      if (!reg.has(to)) reg.set(to, new Map());
      const toRegs = reg.get(to)!;
      for (const [id, registeredAt] of fromRegs) {
        if (!toRegs.has(id)) {
          toRegs.set(id, registeredAt);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  if (reg.size === 0) return [];

  // ---- Pass F: dispatch sites → edges ----
  // recv->field( or recv.field( where field is a known fn-pointer field.
  const DISPATCH_RE = /(\w+)\s*(?:->|\.)\s*(\w+)\s*\(/g;
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const fn of cFns) {
    const s = srcCache.get(fn.filePath);
    if (!s) continue;
    const body = sliceLines(s, fn.startLine, fn.endLine);
    DISPATCH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let added = 0;
    while ((m = DISPATCH_RE.exec(body)) && added < FANOUT_CAP) {
      const recv = m[1]!;
      const field = m[2]!;
      const owners = fieldToStructs.get(field);
      if (!owners || owners.size === 0) continue;
      const visibleOwners = [...owners].filter((owner) => isStructVisible(fn.filePath, owner));
      if (visibleOwners.length === 0) continue;
      // Resolve the receiver's struct type; else fall back to a field name that
      // belongs to exactly one visible struct.
      let struct = recvTypeIn(fn.filePath, body, recv);
      if (!struct || !owners.has(struct)) struct = visibleOwners.length === 1 ? visibleOwners[0]! : null;
      if (!struct) continue;
      const targets = reg.get(slotKey(struct, field));
      if (!targets) continue;
      const line = fn.startLine + body.slice(0, m.index).split('\n').length - 1;
      for (const [tid, registeredAt] of targets) {
        if (tid === fn.id) continue;
        const key = `${fn.id}>${tid}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          source: fn.id,
          target: tid,
          kind: 'calls',
          line,
          provenance: 'heuristic',
          metadata: {
            synthesizedBy: 'fn-pointer-dispatch',
            via: slotLabel(struct, field),
            confidence: 0.8,
            registeredAt,
          },
        });
        if (++added >= FANOUT_CAP) break;
      }
    }
  }
  return edges;
}

/** C/C++ function + method nodes, streamed (memory-safe on symbol-dense repos). */
function* iterateFns(queries: QueryBuilder): IterableIterator<Node> {
  yield* queries.iterateNodesByKind('function');
  yield* queries.iterateNodesByKind('method');
}
