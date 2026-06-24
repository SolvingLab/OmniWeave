/**
 * MCP Tool Definitions
 *
 * Defines the tools exposed by the OmniWeave MCP server.
 */

import type OmniWeave from '../index';
import { findNearestOmniWeaveRoot } from '../directory';
// Lazy-load the heavy OmniWeave chain off the MCP startup path — see the same
// helper in engine.ts. ToolHandler must load to answer tools/list (static
// schemas), but it must NOT drag in sqlite/query layers before the daemon binds;
// OmniWeave is pulled in only when a tool actually opens a project. require() is
// sync + cached (CommonJS build).
const loadOmniWeave = (): typeof import('../index').default =>
  (require('../index') as typeof import('../index')).default;
import {
  detectWorktreeIndexMismatch,
  worktreeMismatchWarning,
  worktreeMismatchNotice,
  type WorktreeIndexMismatch,
} from '../sync/worktree';
import type { PendingFile } from '../sync';
import type { Node, Edge, SearchResult, Subgraph, NodeKind, EdgeKind } from '../types';
import {
  isDistinctiveIdentifier,
  isLowSignalSourceFile,
  isRepositorySnapshotFile,
  isRepositorySnapshotQuery,
  isTestFile,
  normalizeNameToken,
  extractContentSearchPattern,
  escapeContentSnippet,
} from '../search/query-utils';
import {
  existsSync,
  readFileSync,
} from 'fs';
import { clamp, validatePathWithinRoot, validateProjectPath, isConfigLeafNode, CONFIG_LEAF_LANGUAGES } from '../utils';
import { isGeneratedFile } from '../extraction/generated-detection';
import { scanDynamicDispatch } from './dynamic-boundaries';
import { describeSnapshotImportWarning } from '../snapshot-metadata';
import { CALL_SURFACE_EDGE_KINDS } from '../call-surface';
import {
  OmniWeaveBuildFingerprint,
  readCurrentBuildFingerprint,
  runtimeBuildSkew,
  runtimeBuildSkewMessage,
} from './version';

/**
 * An expected, recoverable "omniweave can't serve this" condition — most
 * importantly a project with no index. The dispatch catch converts these to
 * SUCCESS-shaped responses (guidance text, NO isError): an `isError: true`
 * early in a session teaches the agent the toolset is broken and it stops
 * calling omniweave entirely (observed repeatedly), which is exactly wrong
 * for conditions the agent can simply work around (use built-in tools for
 * that codebase / pass projectPath). isError is reserved for "stop trying"
 * cases: security refusals ({@link PathRefusalError}) and genuine
 * malfunctions.
 */
export class NotIndexedError extends Error {}

/**
 * A security refusal (sensitive system path). Stays `isError: true` WITHOUT
 * retry guidance — abandoning this path is the desired agent reaction.
 */
export class PathRefusalError extends Error {}
import { resolve as resolvePath } from 'path';

/** Maximum output length to prevent context bloat (characters) */
const MAX_OUTPUT_LENGTH = 15000;

/** Hard inline ceiling for omniweave_explore after every wrapper is applied. */
const EXPLORE_INLINE_HARD_CEILING = 25_000;

/**
 * Maximum length for free-form string inputs (query, task, symbol).
 * Bounds memory and CPU when a buggy or hostile MCP client sends a
 * huge payload — without this an attacker could ship a 100MB string
 * and force a full FTS5 scan / OOM the server. 10 000 characters is
 * far beyond any realistic legitimate query.
 */
const MAX_INPUT_LENGTH = 10_000;

/**
 * Maximum length for path-like string inputs (projectPath, path
 * filter, glob pattern). Paths beyond a few thousand chars are
 * never legitimate and signal abuse or a bug upstream.
 */
const MAX_PATH_LENGTH = 4_096;

/**
 * Rust path roots that have no file-system equivalent — `crate` is the
 * current crate, `super` is the parent module, `self` is the current
 * module. Used by `matchesSymbol` to strip these before file-path
 * matching so `crate::configurator::stage_apply::run` resolves the
 * same as `configurator::stage_apply::run`.
 */
const RUST_PATH_PREFIXES = new Set(['crate', 'super', 'self']);

/**
 * Node kinds that contain other symbols. For these, `omniweave_node` with
 * `includeCode=true` returns a structural outline (member names + signatures
 * + line numbers) instead of the full body, which for a large class is a
 * multi-thousand-character wall of source that bloats the agent's context.
 */
const CONTAINER_NODE_KINDS = new Set<NodeKind>([
  'class', 'struct', 'interface', 'trait', 'protocol', 'enum', 'namespace', 'module',
]);

function queryAllowsLowSignalSources(query: string): boolean {
  return /\b(test|tests|testing|spec|specs)\b/i.test(query)
    || /\b(research|external|upstream|vendor|vendored|third[-_ ]?party)\b/i.test(query)
    || /\b(?:repo|repository|codebase|source)\s+snapshots?\b/i.test(query)
    || /\bsnapshots?\s+(?:repo|repository|codebase|source)\b/i.test(query)
    || /(?:^|\/)research\/[^/]+\/repos(?:\/|$)/i.test(query);
}

interface AmbiguousExploreToken {
  token: string;
  total: number;
  selected: Node[];
  alternatives: Node[];
}

export type OutputSurface = 'mcp' | 'cli';

const EXPLORE_RELATIONSHIP_KIND_RANK: Record<EdgeKind, number> = {
  calls: 0,
  crossLang: 1,
  produces: 2,
  consumes: 2,
  invokes: 2,
  overrides: 3,
  implements: 4,
  extends: 4,
  instantiates: 5,
  returns: 6,
  type_of: 7,
  decorates: 8,
  references: 9,
  imports: 10,
  exports: 11,
  contains: 99,
};

/** Last `::` / `.` / `/`-separated segment of a qualified symbol. */
function lastQualifierPart(symbol: string): string {
  const parts = symbol.split(/::|[./]/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? symbol;
}

function withAdjacentConceptCompounds(tokens: string[], sourceTokens: string[] = tokens): string[] {
  const expanded = [...tokens];
  const seen = new Set(expanded);
  const isPlainConcept = (token: string) => /^[a-z][a-z0-9_$]*$/.test(token) && !isDistinctiveIdentifier(token);
  const cap = (token: string) => token.charAt(0).toUpperCase() + token.slice(1);

  for (let i = 0; i < sourceTokens.length - 1; i++) {
    const left = sourceTokens[i]!;
    const right = sourceTokens[i + 1]!;
    if (!isPlainConcept(left) || !isPlainConcept(right)) continue;
    for (const candidate of [`${left}${cap(right)}`, `${right}${cap(left)}`]) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      expanded.push(candidate);
      if (expanded.length >= 24) return expanded;
    }
  }

  return expanded;
}

const PRECEDING_PLAIN_NAMED_SEED_STOP_WORDS = new Set([
  'bug', 'bugs', 'broken',
  'crash', 'crashes', 'debug', 'debugging',
  'error', 'errors', 'exception', 'exceptions',
  'fail', 'fails', 'failed', 'failing', 'failure', 'failures',
  'fix', 'fixes', 'fixed', 'fixing',
  'internal', 'issue', 'issues', 'problem', 'problems',
]);

function extractExploreNameTokens(query: string, options: { includePrecedingPlainTokens?: boolean } = {}): string[] {
  const fileExt = /\.(?:java|kt|kts|ts|tsx|js|jsx|mjs|cjs|cs|py|go|rb|php|swift|rs|cpp|cc|cxx|c|h|hpp|scala|lua|dart|vue|svelte|astro)$/i;
  const tokens = [...new Set(
    query.split(/[\s,()[\]]+/)
      .map((t) => t.replace(fileExt, '').trim())
      .filter((t) => t.length >= 3 && /^[A-Za-z_$][\w$]*(?:(?:::|\.)[\w$]+)*$/.test(t))
  )].slice(0, 16);
  if (tokens.length <= 3) return withAdjacentConceptCompounds(tokens);

  const isSpecific = (token: string): boolean => /[.\/]|::/.test(token) || isDistinctiveIdentifier(token);
  const specificIndexes = tokens
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => isSpecific(token))
    .map(({ index }) => index);
  if (specificIndexes.length === 0) return [];

  const keep = new Set(specificIndexes);
  if (options.includePrecedingPlainTokens) {
    for (const index of specificIndexes) {
      let added = 0;
      for (let i = index - 1; i >= 0 && !isSpecific(tokens[i]!); i--) {
        if (PRECEDING_PLAIN_NAMED_SEED_STOP_WORDS.has(tokens[i]!.toLowerCase())) continue;
        keep.add(i);
        added++;
        if (added >= 2) break;
      }
    }
  }

  return withAdjacentConceptCompounds(tokens.filter((_, index) => keep.has(index)), tokens);
}

/**
 * Calculate the recommended number of omniweave_explore calls based on project size.
 * Larger codebases need more exploration calls to cover their surface area,
 * but smaller ones should use fewer to avoid unnecessary overhead.
 */
export function getExploreBudget(fileCount: number): number {
  if (fileCount < 500) return 1;
  if (fileCount < 5000) return 2;
  if (fileCount < 15000) return 3;
  if (fileCount < 25000) return 4;
  return 5;
}

/**
 * Adaptive output budget for `omniweave_explore`, scaled to project size.
 *
 * Smaller codebases get a tighter total cap, fewer default files, smaller
 * per-file cap, and tighter clustering — so a focused query on a 100-file
 * project doesn't dump a whole file's worth of source into the agent's
 * context. Larger codebases keep the generous defaults because the
 * agent's native discovery cost (grep + find + many Reads) genuinely
 * dwarfs a fat explore call at that scale.
 *
 * Meta-text (relationships map, "additional relevant files" list,
 * completeness signal, budget note) is gated off for tiny projects
 * where one rich call is the whole story and the extra prose is just
 * overhead.
 *
 * This (the per-call output ceiling) and `getExploreBudget` (the per-session
 * call count) both scale with project size but use INDEPENDENT breakpoints:
 * this one adds a sub-150-file micro-tier and tops out at 15000, while the
 * call budget has no micro-tier and keeps widening through 25000. They are
 * two separate knobs, not one shared tier.
 */
export interface ExploreOutputBudget {
  /** Hard cap on total output characters. */
  maxOutputChars: number;
  /** Default `maxFiles` when the caller didn't specify one. */
  defaultMaxFiles: number;
  /** Cap on contiguous source returned per file (across all its clusters). */
  maxCharsPerFile: number;
  /** Cluster gap threshold in lines — tighter clustering on small projects. */
  gapThreshold: number;
  /** Max symbols listed in the per-file header (`#### path — sym(kind), ...`). */
  maxSymbolsInFileHeader: number;
  /** Max edges shown per relationship kind in the Relationships section. */
  maxEdgesPerRelationshipKind: number;
  /** Include the "Relationships" section. */
  includeRelationships: boolean;
  /** Include the "Additional relevant files (not shown)" trailing list. */
  includeAdditionalFiles: boolean;
  /** Include the "Complete source code is included above…" reminder. */
  includeCompletenessSignal: boolean;
  /** Include the explore-budget reminder at the end. */
  includeBudgetNote: boolean;
}

export function getExploreOutputBudget(fileCount: number): ExploreOutputBudget {
  // Tiered budget, scaled to project size. The budget is a CEILING (relevance
  // still gates WHAT is included), and it MUST stay under the agent's INLINE
  // tool-result cap (~25K chars). Above that, the host externalizes the result
  // to a file the agent then Reads back — re-introducing a read AND the
  // cache-write cost — which is exactly what a 35K vscode explore did in the
  // n=4 README A/B. So even large repos cap at ~24K: the answer is the handful
  // of ~100-line flow windows the agent would have grep-located and read (it
  // natively reads ~6–9 files, median 100-line ranges), NOT a sprawl of 12
  // files. Concentration onto the flow emerges from this cap + the named-file-
  // first sort dropping peripheral files. Invariant: a larger tier must never
  // get a smaller `maxCharsPerFile` than a smaller tier.
  if (fileCount < 150) {
    return {
      // ITER3: revert iter2's aggressive body shrink (forced Read fallback —
      // the per-file 2.5K cap pushed the agent to Read instead of node).
      // Back to the iter1 shape (13K/4/3.8K) but keep the test-file
      // hard-exclude. The cost lever for this tier lives in steering the
      // agent to stop after 1-2 calls, not in this budget.
      maxOutputChars: 13000,
      defaultMaxFiles: 4,
      maxCharsPerFile: 3800,
      gapThreshold: 7,
      maxSymbolsInFileHeader: 5,
      maxEdgesPerRelationshipKind: 4,
      includeRelationships: false,
      includeAdditionalFiles: false,
      includeCompletenessSignal: false,
      includeBudgetNote: false,
    };
  }
  if (fileCount < 500) {
    return {
      // ITER3: same revert/keep-filter pattern as <150.
      maxOutputChars: 18000,
      defaultMaxFiles: 5,
      maxCharsPerFile: 3800,
      gapThreshold: 8,
      maxSymbolsInFileHeader: 6,
      maxEdgesPerRelationshipKind: 6,
      includeRelationships: false,
      includeAdditionalFiles: false,
      includeCompletenessSignal: false,
      includeBudgetNote: false,
    };
  }
  if (fileCount < 5000) {
    return {
      // ~150-line per-file window (the native read unit) × ~6 files, capped at
      // the ~24K inline ceiling so the response is never externalized. Per-file
      // stays ≥ the <500 tier (3800) — monotonic.
      maxOutputChars: 24000,
      defaultMaxFiles: 8,
      maxCharsPerFile: 6500,
      gapThreshold: 12,
      maxSymbolsInFileHeader: 10,
      maxEdgesPerRelationshipKind: 10,
      includeRelationships: true,
      includeAdditionalFiles: true,
      includeCompletenessSignal: true,
      includeBudgetNote: true,
    };
  }
  // Large + very-large repos: SAME ~24K inline ceiling (a bigger response just
  // externalizes — see vscode). More files indexed → more CALLS via
  // getExploreBudget, not a bigger single response. Per-file 7000 (≥ smaller
  // tiers) gives the central file a ~180-line orientation window.
  if (fileCount < 15000) {
    return {
      maxOutputChars: 24000,
      defaultMaxFiles: 8,
      maxCharsPerFile: 7000,
      gapThreshold: 15,
      maxSymbolsInFileHeader: 15,
      maxEdgesPerRelationshipKind: 15,
      includeRelationships: true,
      includeAdditionalFiles: true,
      includeCompletenessSignal: true,
      includeBudgetNote: true,
    };
  }
  return {
    maxOutputChars: 24000,
    defaultMaxFiles: 8,
    maxCharsPerFile: 7000,
    gapThreshold: 15,
    maxSymbolsInFileHeader: 15,
    maxEdgesPerRelationshipKind: 15,
    includeRelationships: true,
    includeAdditionalFiles: true,
    includeCompletenessSignal: true,
    includeBudgetNote: true,
  };
}

function parseExploreMaxFiles(value: unknown, defaultMaxFiles: number): number {
  if (value === undefined || value === null) return defaultMaxFiles;
  if (typeof value === 'string' && value.trim() === '') return defaultMaxFiles;

  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value.trim())
      : Number.NaN;

  if (!Number.isFinite(numeric)) return defaultMaxFiles;
  return clamp(Math.floor(numeric), 1, 20);
}

function truncateExploreAtCompleteBoundary(output: string, hardCeiling: number, suffix: string): string {
  const cutLimit = Math.max(0, hardCeiling - suffix.length);
  const cut = output.slice(0, cutLimit);
  const sourceHeader = cut.lastIndexOf('\n### Source Code');
  const closeFenceMatches = [...cut.matchAll(/\n```\n/g)];
  const lastCompleteSourceEnd = closeFenceMatches.length > 0
    ? (closeFenceMatches[closeFenceMatches.length - 1]!.index ?? -1) + '\n```\n'.length
    : -1;

  if (lastCompleteSourceEnd > sourceHeader) {
    return cut.slice(0, lastCompleteSourceEnd).trimEnd() + suffix;
  }

  const lastSection = cut.lastIndexOf('\n#### ');
  const boundary = lastSection > sourceHeader
    ? lastSection
    : (sourceHeader > 0 ? sourceHeader : cut.lastIndexOf('\n'));
  const safe = boundary > 0 ? cut.slice(0, boundary) : cut;
  return safe.trimEnd() + suffix;
}

function capExploreFinalText(text: string, outputSurface: OutputSurface = 'mcp'): string {
  if (text.length <= EXPLORE_INLINE_HARD_CEILING) return text;
  const retry = outputSurface === 'cli'
    ? 'run another `omniweave explore "<names>"` with the specific names'
    : 'run another omniweave_explore with the specific names';
  const suffix = `\n\n... (output truncated to final inline budget after freshness/worktree notices; trailing sections were dropped whole to keep this inline and avoid partial source. Treat only complete source blocks shown above as already Read. For uncovered names/files, ${retry}.)`;
  return truncateExploreAtCompleteBoundary(text, EXPLORE_INLINE_HARD_CEILING, suffix);
}

/**
 * Whether `omniweave_explore` should prefix source lines with their line
 * numbers (cat -n style: `<num>\t<code>`).
 *
 * Line numbers let the agent cite `file:line` straight from the explore
 * payload instead of re-Reading the file just to find a line number — the
 * dominant residual cost on precise-tracing questions (#185 follow-up).
 *
 * Defaults ON. Set `OMNIWEAVE_EXPLORE_LINENUMS=0` to disable (used by the
 * A/B harness to measure the payload-cost vs. read-savings tradeoff).
 */
function exploreLineNumbersEnabled(): boolean {
  return process.env.OMNIWEAVE_EXPLORE_LINENUMS !== '0';
}

/**
 * Adaptive explore sizing (default ON). `omniweave_explore` skeletonizes OFF-SPINE
 * polymorphic-sibling files — a file whose class is one of ≥3 interchangeable
 * implementations of a shared interface (e.g. OkHttp's `: Interceptor` classes) —
 * to class + member signatures (bodies elided), keeping the on-spine exemplar full.
 * This sizes the response to the answer instead of the budget cap on sibling-heavy
 * flows (OkHttp interceptor-chain explore 28.5k→16.6k, ~28% cheaper than native
 * search, reads flat). It is PROVABLY INERT elsewhere: distinct pipeline steps (no
 * ≥3-implementer supertype, e.g. Excalidraw's `renderStaticScene`) and on-spine
 * files keep full source — output is byte-identical to shipped on excalidraw /
 * tokio / django / vscode / gin. Set `OMNIWEAVE_ADAPTIVE_EXPLORE=0` to disable.
 */
function adaptiveExploreEnabled(): boolean {
  return process.env.OMNIWEAVE_ADAPTIVE_EXPLORE !== '0' && process.env.OMNIWEAVE_ADAPTIVE_EXPLORE !== 'false';
}

/**
 * Prefix each line of a source slice with its 1-based line number, matching
 * the Read tool's `cat -n` convention (number + tab) so the agent treats it
 * the same way it treats Read output.
 *
 * @param slice  contiguous source text (already extracted from the file)
 * @param firstLineNumber  the 1-based line number of the slice's first line
 */
function numberSourceLines(slice: string, firstLineNumber: number): string {
  const out: string[] = [];
  const split = slice.split('\n');
  for (let i = 0; i < split.length; i++) {
    out.push(`${firstLineNumber + i}\t${split[i]}`);
  }
  return out.join('\n');
}

/**
 * Per-file staleness banner emitted at the top of a tool response when the
 * file watcher has pending events for files referenced by the response.
 * The agent uses this to verify the listed files or refresh the graph before
 * trusting relationships/line ranges, without blocking on debounce (issue #403).
 */
export function formatStaleBanner(stale: PendingFile[], outputSurface: OutputSurface = 'mcp'): string {
  const now = Date.now();
  const lines = stale.map((p) => {
    const ageMs = Math.max(0, now - p.lastSeenMs);
    const label = p.indexing ? 'indexing in progress' : 'pending sync';
    return `  - ${p.path} (edited ${ageMs}ms ago, ${label})`;
  });
  const focusedRead = outputSurface === 'cli'
    ? 'Use `omniweave node <path>`'
    : 'Use `omniweave_node <path>`';
  const syncStep = outputSurface === 'cli'
    ? 'run `omniweave sync`'
    : 'from a shell run `omniweave sync`';
  return (
    '⚠️ Some files referenced below were edited since the last index sync — ' +
    'their omniweave symbols, edges, or line ranges may be stale:\n' +
    lines.join('\n') +
    '\nIf source blocks are shown below, their bytes were re-read from disk, ' +
    `but the graph context for those files may still be stale. ${focusedRead} ` +
    `for a focused current file read, or ${syncStep} before trusting relationships. ` +
    'The rest of this response is fresh.'
  );
}

/**
 * Compact footer listing pending files that are NOT referenced in this
 * response. Gives the agent a complete project-wide freshness picture
 * without bloating the main banner.
 */
export function formatStaleFooter(stale: PendingFile[]): string {
  const MAX = 5;
  const now = Date.now();
  const shown = stale.slice(0, MAX);
  const lines = shown.map((p) => {
    const ageMs = Math.max(0, now - p.lastSeenMs);
    return `  - ${p.path} (edited ${ageMs}ms ago)`;
  });
  const more = stale.length > MAX ? `\n  - …and ${stale.length - MAX} more` : '';
  return (
    `(Note: ${stale.length} file(s) elsewhere in this project are pending index ` +
    `sync but were not referenced above:\n${lines.join('\n')}${more})`
  );
}

type ChangedFileKind = 'added' | 'modified' | 'removed';

interface ChangedFileEntry {
  path: string;
  kind: ChangedFileKind;
}

function changedFileEntries(changes: { added: string[]; modified: string[]; removed: string[] }): ChangedFileEntry[] {
  return [
    ...changes.added.map((path) => ({ path, kind: 'added' as const })),
    ...changes.modified.map((path) => ({ path, kind: 'modified' as const })),
    ...changes.removed.map((path) => ({ path, kind: 'removed' as const })),
  ];
}

function changedEntryKey(entry: ChangedFileEntry): string {
  return `${entry.kind}\0${entry.path}`;
}

function subtractChangedEntries(all: ChangedFileEntry[], source: ChangedFileEntry[]): ChangedFileEntry[] {
  const sourceKeys = new Set(source.map(changedEntryKey));
  return all.filter((entry) => !sourceKeys.has(changedEntryKey(entry)));
}

function partitionLowSignalChangedEntries(entries: ChangedFileEntry[]): {
  firstParty: ChangedFileEntry[];
  lowSignal: ChangedFileEntry[];
} {
  const firstParty: ChangedFileEntry[] = [];
  const lowSignal: ChangedFileEntry[] = [];
  for (const entry of entries) {
    (isLowSignalSourceFile(entry.path) ? lowSignal : firstParty).push(entry);
  }
  return { firstParty, lowSignal };
}

function pushCappedChangedEntries(lines: string[], entries: ChangedFileEntry[], cap = 50): void {
  for (const p of entries.slice(0, cap)) {
    lines.push(`- ${p.path} (${p.kind})`);
  }
  if (entries.length > cap) {
    lines.push(`- ...and ${entries.length - cap} more`);
  }
}

/**
 * Whole-response freshness banner for watcher-less reads (CLI, cross-project
 * MCP, disabled watcher policy). `getPendingFiles()` is empty there by design,
 * so we fall back to the same changed-file signal that powers status.
 */
export function formatChangedIndexBanner(changed: ChangedFileEntry[], outputSurface: OutputSurface = 'mcp'): string {
  const lines = changed.map((p) => `  - ${p.path} (${p.kind})`);
  const focusedRead = outputSurface === 'cli' ? '`omniweave node <path>`' : '`omniweave_node <path>`';
  const syncStep = outputSurface === 'cli' ? 'run `omniweave sync`' : 'from a shell, run `omniweave sync`';
  return (
    '⚠️ The OmniWeave index is behind the worktree — files referenced below changed or were removed since the last index:\n' +
    lines.join('\n') +
    '\nSource blocks below are re-read from disk when shown, but symbols, edges, ranking, and line ranges may still come from the old index. ' +
    `${syncStep} before trusting relationships, or use ${focusedRead} for focused current reads.`
  );
}

/**
 * Compact footer for watcher-less reads when changed files exist elsewhere in
 * the project but are not referenced by this response.
 */
export function formatChangedIndexFooter(changed: ChangedFileEntry[]): string {
  const MAX = 5;
  const shown = changed.slice(0, MAX);
  const lines = shown.map((p) => `  - ${p.path} (${p.kind})`);
  const more = changed.length > MAX ? `\n  - …and ${changed.length - MAX} more` : '';
  return (
    `(Note: ${changed.length} file(s) elsewhere in this project changed since ` +
    `the last index but were not referenced above:\n${lines.join('\n')}${more})`
  );
}

function formatStaleNoResultNotice(stale: PendingFile[], outputSurface: OutputSurface = 'mcp'): string {
  const MAX = 5;
  const now = Date.now();
  const shown = stale.slice(0, MAX);
  const lines = shown.map((p) => {
    const ageMs = Math.max(0, now - p.lastSeenMs);
    const label = p.indexing ? 'indexing in progress' : 'pending sync';
    return `  - ${p.path} (edited ${ageMs}ms ago, ${label})`;
  });
  const more = stale.length > MAX ? `\n  - …and ${stale.length - MAX} more` : '';
  const syncStep = outputSurface === 'cli' ? 'run `omniweave sync`' : 'from a shell run `omniweave sync`';
  return (
    '⚠️ This empty explore result may be stale — files changed since the last index sync are not represented in the graph yet:\n' +
    lines.join('\n') +
    more +
    `\nIf your query targets one of these files, wait for sync or ${syncStep} before trusting structural results. For immediate work on a newly created file, use normal file tools for that path.`
  );
}

function formatChangedIndexNoResultNotice(changed: ChangedFileEntry[], outputSurface: OutputSurface = 'mcp'): string {
  const MAX = 5;
  const shown = changed.slice(0, MAX);
  const lines = shown.map((p) => `  - ${p.path} (${p.kind})`);
  const more = changed.length > MAX ? `\n  - …and ${changed.length - MAX} more` : '';
  const syncStep = outputSurface === 'cli' ? 'run `omniweave sync`' : 'from a shell run `omniweave sync`';
  return (
    '⚠️ This empty explore result may be stale — files changed since the last index are not represented in the graph yet:\n' +
    lines.join('\n') +
    more +
    `\nIf your query targets one of these files, ${syncStep} before trusting structural results. For immediate work on a newly created file, use normal file tools for that path.`
  );
}

function emptyIndexMessage(outputSurface: OutputSurface = 'mcp'): string {
  const refreshStep = outputSurface === 'cli'
    ? 'Run `omniweave sync` after source files are present.'
    : 'Refresh the index after source files are present.';
  return [
    'No files indexed.',
    'The OmniWeave index is initialized but contains 0 files.',
    'This is an empty index state, not a tool failure.',
    refreshStep,
  ].join(' ');
}

function isExploreNoResultText(text: string): boolean {
  return text.startsWith('No relevant code found for ');
}

function responseMentionsPath(text: string, filePath: string): boolean {
  const isPathChar = (char: string | undefined): boolean =>
    char !== undefined && /[A-Za-z0-9._~+%/-]/.test(char);

  let index = text.indexOf(filePath);
  while (index !== -1) {
    const before = index > 0 ? text[index - 1] : undefined;
    const after = text[index + filePath.length];
    if (!isPathChar(before) && !isPathChar(after)) return true;
    index = text.indexOf(filePath, index + filePath.length);
  }
  return false;
}

/**
 * MCP Tool definition
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, PropertySchema>;
    required?: string[];
  };
}

interface PropertySchema {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

export interface ToolExecutionOptions {
  outputSurface?: OutputSurface;
  enforceToolAllowlist?: boolean;
}

/**
 * Common projectPath property for cross-project queries
 */
const projectPathProperty: PropertySchema = {
  type: 'string',
  description: 'Path to a different project with .omniweave/ initialized. If omitted, uses current project. Use this to query other codebases.',
};

/**
 * All OmniWeave MCP tools
 *
 * Designed for minimal context usage - use omniweave_explore as the primary tool
 * (one call usually answers the whole question), and only use other tools for
 * targeted follow-up queries.
 *
 * All tools support cross-project queries via the optional `projectPath` parameter.
 */
export const tools: ToolDefinition[] = [
  {
    name: 'omniweave_search',
    description: 'Quick symbol search by name, or explicit raw file-content search via `query: "pattern:<literal>"` / `pattern`. Content hits are file/snippet evidence only, not structural facts. Use omniweave_explore to understand an area in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Symbol name or partial name (e.g., "auth", "signIn", "UserService"). Prefix with `pattern:` for literal raw-content search.',
        },
        pattern: {
          type: 'string',
          description: 'Literal substring to find in raw file CONTENT (e.g. "CSRF verification failed"). Trigram-indexed: exact substring, NOT regex; needs >=3 chars. Use this when query (symbol search) cannot find the text because it is not a symbol. Takes precedence over query when set.',
        },
        kind: {
          type: 'string',
          description: 'Filter by node kind (symbol/query mode only)',
          enum: ['function', 'method', 'class', 'interface', 'type', 'variable', 'route', 'component'],
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 10; clamped to 1-100)',
          default: 10,
        },
        projectPath: projectPathProperty,
      },
      required: [],
    },
  },
  {
    name: 'omniweave_callers',
    description: 'List functions that call <symbol>. For the full flow, use omniweave_explore.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Name of the function, method, or class to find callers for',
        },
        file: {
          type: 'string',
          description: 'Narrow to the definition in this file (path or suffix) when several same-named symbols exist (e.g. one UserService per app in a monorepo)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of callers to return (default: 20; clamped to 1-100)',
          default: 20,
        },
        projectPath: projectPathProperty,
      },
      required: ['symbol'],
    },
  },
  {
    name: 'omniweave_callees',
    description: 'List functions that <symbol> calls. For the full flow, use omniweave_explore.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Name of the function, method, or class to find callees for',
        },
        file: {
          type: 'string',
          description: 'Narrow to the definition in this file (path or suffix) when several same-named symbols exist',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of callees to return (default: 20; clamped to 1-100)',
          default: 20,
        },
        projectPath: projectPathProperty,
      },
      required: ['symbol'],
    },
  },
  {
    name: 'omniweave_impact',
    description: 'List symbols affected by changing <symbol>. Use before a refactor.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Name of the symbol to analyze impact for',
        },
        file: {
          type: 'string',
          description: 'Narrow to the definition in this file (path or suffix) when several same-named symbols exist',
        },
        depth: {
          type: 'number',
          description: 'How many levels of dependencies to traverse (default: 2; clamped to 1-10)',
          default: 2,
        },
        projectPath: projectPathProperty,
      },
      required: ['symbol'],
    },
  },
  {
    name: 'omniweave_node',
    description: 'Two modes. (1) READ A FILE — use INSTEAD of the Read tool: pass `file` (a path or basename) with no `symbol` and it returns that file\'s current on-disk source with line numbers, exactly the shape Read gives you (`<n>\\t<line>`, safe to Edit from), narrowable with `offset`/`limit` just like Read — PLUS a one-line note of which files depend on it. Same bytes as Read, faster (served from the index), with the blast radius attached. Use it whenever you would Read a source file. (2) ONE SYMBOL you can name — its location, signature, verbatim source (includeCode=true) and caller/callee trail in one call, so before changing it you see what calls it and what your edit would break. For an AMBIGUOUS name it returns EVERY matching definition\'s body in one call (so you never Read a file to find the right overload); pass `file`/`line` to pin one. Use omniweave_explore for several related symbols or the full flow.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Name of the symbol to read (symbol mode). Omit it and pass `file` alone to read a whole file like Read.',
        },
        includeCode: {
          type: 'boolean',
          description: 'Symbol mode: include the symbol\'s full body (default: false). Ignored in file mode, which always returns source unless `symbolsOnly` is set.',
          default: false,
        },
        file: {
          type: 'string',
          description: 'A file path or basename (e.g. "harness.rs", "src/auth/session.ts"). Pass it ALONE (no symbol) to READ the file like the Read tool — its full source with line numbers + which files depend on it. Or pass it WITH a symbol to disambiguate an overloaded name to the definition in this file.',
        },
        offset: {
          type: 'number',
          description: 'File mode: 1-based line to start reading from, exactly like Read\'s offset. Defaults to the start of the file.',
        },
        limit: {
          type: 'number',
          description: 'File mode: maximum number of lines to return, exactly like Read\'s limit. Defaults to the whole file (capped at 2000 lines, like Read).',
        },
        symbolsOnly: {
          type: 'boolean',
          description: 'File mode: return just the file\'s symbol map + dependents (a cheap structural overview) instead of its source.',
          default: false,
        },
        line: {
          type: 'number',
          description: 'Symbol mode only: disambiguate to the definition at/around this line (use with the file:line a trail showed you).',
        },
        projectPath: projectPathProperty,
      },
      required: [],
    },
  },
  {
    name: 'omniweave_explore',
    description: 'PRIMARY TOOL — call FIRST for almost any question OR before an edit: how does X work, architecture, a bug, where/what is X, surveying an area, or the symbols you are about to change. Returns the verbatim source of the relevant symbols grouped by file in ONE capped call (Read-equivalent — treat the shown source as already Read; do NOT re-open those files), plus the call path among them. Query can be a natural-language question OR a bag of symbol/file names. Usually the ONLY call you need — the relevant structural context, in far fewer tokens and round-trips than a search/Read/Grep loop.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Symbol names, file names, or short code terms to explore (e.g., "AuthService loginUser session-manager", "GraphTraverser BFS impact traversal.ts"). For a flow question, name the symbols spanning the flow (e.g. "mutateElement renderScene"). A natural-language question works too — no prior omniweave_search needed.',
        },
        maxFiles: {
          type: 'number',
          description: 'Maximum number of files to include source code from. If omitted, OmniWeave uses an adaptive project-size default.',
        },
        projectPath: projectPathProperty,
      },
      required: ['query'],
    },
  },
  {
    name: 'omniweave_status',
    description: 'Index health check (files / nodes / edges). Skip unless debugging.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: projectPathProperty,
      },
    },
  },
  {
    name: 'omniweave_files',
    description: 'Indexed file tree with language + symbol counts. Faster than Glob for project layout.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Filter to files under this directory path (e.g., "src/components"). Returns all files if not specified.',
        },
        pattern: {
          type: 'string',
          description: 'Filter files matching this glob pattern (e.g., "*.tsx", "**/*.test.ts")',
        },
        format: {
          type: 'string',
          description: 'Output format: "tree" (hierarchical, default), "flat" (simple list), "grouped" (by language)',
          enum: ['tree', 'flat', 'grouped'],
          default: 'tree',
        },
        includeMetadata: {
          type: 'boolean',
          description: 'Include file metadata like language and symbol count (default: true)',
          default: true,
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum directory depth to show (default: unlimited; clamped to 1-20 when set)',
        },
        projectPath: projectPathProperty,
      },
    },
  },
];

function shortToolName(name: string): string {
  return name.trim().replace(/^omniweave_/, '');
}

function parseToolAllowlist(raw = process.env.OMNIWEAVE_MCP_TOOLS): Set<string> | null {
  if (!raw || !raw.trim()) return null;
  const set = new Set(raw.split(',').map(shortToolName).filter(Boolean));
  return set.size > 0 ? set : null;
}

function visibleToolsForAllowlist(allow: Set<string> | null): ToolDefinition[] {
  return allow
    ? tools.filter(t => allow.has(shortToolName(t.name)))
    : tools.filter(t => DEFAULT_MCP_TOOLS.has(shortToolName(t.name)));
}

const TINY_REPO_FILE_THRESHOLD = 500;
const TINY_REPO_CORE_TOOLS = new Set([
  'omniweave_explore',
  'omniweave_search',
  'omniweave_node',
]);

function toolsForSurface(allow: Set<string> | null, fileCount?: number): ToolDefinition[] {
  let visible = visibleToolsForAllowlist(allow);
  if (fileCount === undefined) return visible;

  if (fileCount < TINY_REPO_FILE_THRESHOLD) {
    visible = visible.filter(t => TINY_REPO_CORE_TOOLS.has(t.name));
  }

  const callBudget = getExploreBudget(fileCount);
  const outputBudget = getExploreOutputBudget(fileCount);
  return visible.map(tool => {
    if (tool.name === 'omniweave_explore') {
      return {
        ...tool,
        description: `${tool.description} Budget: make at most ${callBudget} calls for this project (${fileCount.toLocaleString()} files indexed). If maxFiles is omitted, this project defaults to ${outputBudget.defaultMaxFiles} source files per call.`,
      };
    }
    return tool;
  });
}

/**
 * Allowlist-filtered tool definitions WITHOUT an engine — the static surface the
 * proxy answers `tools/list` with before any project is open. Mirrors
 * `ToolHandler.getTools()` when a file count is provided; without one, only
 * schema-safe static fields are returned.
 */
export function getStaticTools(fileCount?: number): ToolDefinition[] {
  return toolsForSurface(parseToolAllowlist(), fileCount);
}

/**
 * The MCP tools served by DEFAULT (short names). The other defined tools
 * (callees, files, status) remain fully functional — handlers stay, the
 * library API and CLI are untouched, and `OMNIWEAVE_MCP_TOOLS` re-enables
 * any of them — they just aren't LISTED to agents anymore.
 *
 * Evidence for the surface (the "adapt the tool to the agent" principle —
 * fewer tools = fewer mis-picks, and presence itself steers):
 * - `omniweave_callers` stays: exhaustive call-site enumeration (every
 *   caller with file:line, callback registrations labeled, one section per
 *   same-named definition) is the one job explore/node don't replicate.
 * - `omniweave_impact` stays: transitive blast-radius ("what does changing X
 *   affect, across all depths") is a one-call closure. Round-4 A/B measured
 *   the cost of NOT listing it — on a deep (4-hop) django impact question the
 *   agent fell back to ~20 recursive `callers` calls to rebuild the closure
 *   by hand, shrinking OmniWeave's tool-savings to ~35% (vs 70–96% on the
 *   reverse-callers questions). The earlier "ZERO recorded runs" was a
 *   self-fulfilling absence (the tool wasn't listed). The inline blast-radius
 *   on explore/node is 1-hop only; transitive questions genuinely need this.
 * - `omniweave_callees` is redundant by construction: a symbol's body (which
 *   node returns) IS its callee list, plus the caller/callee trail.
 * - `omniweave_files` / `omniweave_status`: the tiny-repo audit (see
 *   getTools) found they "reduce to one grep"; staleness banners already
 *   inline the pending-sync info on every read tool, and the CLI covers
 *   diagnostics.
 */
const DEFAULT_MCP_TOOLS = new Set(['explore', 'node', 'search', 'callers', 'impact']);

/**
 * Tool handler that executes tools against a OmniWeave instance
 *
 * Supports cross-project queries via the projectPath parameter.
 * Other projects are opened on-demand and cached for performance.
 */
export class ToolHandler {
  // Cache of opened OmniWeave instances for cross-project queries
  private projectCache: Map<string, OmniWeave> = new Map();
  // The directory the server last searched for a default project. Surfaced in
  // the "not initialized" error so users can see why detection missed.
  private defaultProjectHint: string | null = null;
  // Per-start-path cache of the git worktree/index mismatch (issue #155). The
  // mismatch is a fixed property of (where the request came from → which
  // .omniweave/ it resolves to), so the up-to-two `git rev-parse` spawns run
  // once and every later tool call reuses the result — never shelling out to
  // git on the hot path. `undefined` = not computed yet; `null` = no mismatch.
  private worktreeMismatchCache: Map<string, WorktreeIndexMismatch | null> = new Map();
  // Gate that the MCP engine pokes after `cg.open()` so the first tool call
  // blocks on the post-open filesystem reconcile (catch-up sync). Without
  // this, a tool call that races past `catchUpSync()` serves rows for files
  // that were deleted (or edited) while no MCP server was running — and the
  // per-file staleness banner can't help, because `getPendingFiles()` is
  // populated by the watcher, not by catch-up. Cleared on first await so
  // subsequent calls don't pay any cost.
  private catchUpGate: Promise<void> | null = null;

  constructor(private cg: OmniWeave | null) {}

  /**
   * Update the default OmniWeave instance (e.g. after lazy initialization)
   */
  setDefaultOmniWeave(cg: OmniWeave): void {
    this.cg = cg;
  }

  /**
   * Engine-only: register the catch-up sync promise so the next `execute()`
   * call awaits it before serving. The handler swallows rejections (the
   * engine logs them) so a sync failure never propagates as a tool error;
   * we still want to serve a best-effort result over the same potentially-
   * stale data, which is what would have happened without the gate.
   */
  setCatchUpGate(p: Promise<void> | null): void {
    this.catchUpGate = p;
  }

  /**
   * Record the directory the server tried to resolve the default project from.
   * Used only to make the "no default project" error actionable.
   */
  setDefaultProjectHint(searchedPath: string): void {
    this.defaultProjectHint = searchedPath;
  }

  /**
   * Whether a default OmniWeave instance is available
   */
  hasDefaultOmniWeave(): boolean {
    return this.cg !== null;
  }

  /**
   * Optional allowlist of exposed tools, parsed from the OMNIWEAVE_MCP_TOOLS
   * env var (comma-separated short names, e.g. "trace,search,node,context").
   * Unset/empty → every tool is exposed. Lets an operator (or an A/B harness)
   * trim the tool surface without rebuilding the client config; the ablated
   * tool is then truly absent from ListTools rather than merely denied on call.
   * Matching is on the short form, so "node" and "omniweave_node" both work.
   */
  private toolAllowlist(): Set<string> | null {
    return parseToolAllowlist();
  }

  /** Whether a tool name passes the OMNIWEAVE_MCP_TOOLS allowlist (if any). */
  private isToolAllowed(name: string): boolean {
    const allow = this.toolAllowlist();
    return !allow || allow.has(shortToolName(name));
  }

  /**
   * Get tool definitions with dynamic descriptions based on project size.
   * The omniweave_explore tool description includes a budget recommendation
   * scaled to the number of indexed files. Honors the OMNIWEAVE_MCP_TOOLS
   * allowlist so a trimmed surface is reflected in ListTools.
   */
  getTools(): ToolDefinition[] {
    const allow = this.toolAllowlist();
    // No explicit allowlist → the default 5-tool surface (see
    // DEFAULT_MCP_TOOLS for the evidence). An allowlist replaces the default
    // before project-size shaping; tiny repos still get the smaller ListTools
    // surface below, while execute() remains guarded only by the allowlist.
    let visible = visibleToolsForAllowlist(allow);
    if (!this.cg) return visible;

    try {
      const stats = this.cg.getStats();

      // Tiny-repo tool gating: on projects under TINY_REPO_FILE_THRESHOLD
      // files, only expose the core trio (search, node, explore) — one
      // below even the 4-tool default: at this scale callers, too, reduces
      // to one grep. (Historical note: the audit below ran when context and
      // trace still existed; its "5 core tools" are today's trio.)
      //
      // n=2 audits ruled out cutting below 5 tools:
      // - 3-tool gate (search + context + trace): cost regressed on
      //   cobra/ky/sinatra. The agent fell back to raw Reads to cover
      //   what omniweave_node + omniweave_explore would have answered.
      // - 1-tool gate (search only): catastrophic regression — express
      //   went from -43% WIN to +107% LOSS. With only search, the agent
      //   can't navigate the call graph structurally and reads everything.
      //
      // 5 is the empirical lower bound. Tools beyond search/context/
      // node/explore/trace pay overhead that the agent doesn't recoup
      // on tiny-repo flow questions.
      // ITER4: raise threshold 150 → 500 so single-file frameworks
      // (sinatra at 159, slim_framework around 200) also get the
      // 5-tool surface. The empirical 5-tool floor was set on <150
      // probes; iter3 measurement showed sinatra is structurally the
      // SAME problem as cobra (single-file WITHOUT-arm Read wins),
      // so it deserves the same gating.
      return toolsForSurface(allow, stats.fileCount);
    } catch {
      return visible;
    }
  }

  /**
   * Get OmniWeave instance for a project
   *
   * If projectPath is provided, opens that project's OmniWeave (cached).
   * Otherwise returns the default OmniWeave instance.
   *
   * Walks up parent directories to find the nearest .omniweave/ folder,
   * similar to how git finds .git/ directories.
   */
  private getOmniWeave(projectPath?: string): OmniWeave {
    if (!projectPath) {
      if (!this.cg) {
        const searched = this.defaultProjectHint ?? process.cwd();
        throw new NotIndexedError(
          'No OmniWeave project is loaded for this session.\n' +
          `Searched for a .omniweave/ directory starting from: ${searched}\n` +
          'If this project IS indexed, this is a working-directory detection issue: ' +
          "the MCP client launched the server outside your project and didn't report the " +
          'workspace root. Fix it either way:\n' +
          '  • Pass projectPath to the tool call, e.g. projectPath: "/absolute/path/to/your/project"\n' +
          '  • Or add --path to the server\'s MCP config args: ["serve", "--mcp", "--path", "/absolute/path/to/your/project"]\n' +
          'If the project simply has no index, continue with your built-in tools (Read/Grep/Glob) ' +
          "and don't call omniweave again this session — the user can run 'omniweave init' to enable it."
        );
      }
      return this.freshen(this.cg);
    }

    // Reject sensitive system directories before opening. Only validate a
    // path that actually exists — a nested or not-yet-created sub-path of a
    // real project must still be allowed to resolve UP to its .omniweave/
    // root below (issue #238), so we don't run the existence-checking
    // validator on paths that are meant to walk up.
    if (existsSync(projectPath)) {
      const pathError = validateProjectPath(projectPath);
      if (pathError) {
        throw new PathRefusalError(pathError);
      }
    }

    // Always re-resolve the nearest .omniweave/. A long-lived daemon can first
    // see a nested worktree before it has its own index, then keep serving the
    // parent checkout forever if we cache by the original input path.
    const resolvedRoot = findNearestOmniWeaveRoot(projectPath);

    if (!resolvedRoot) {
      throw new NotIndexedError(
        `The project at ${projectPath} isn't indexed with omniweave (no .omniweave/ directory found ` +
        'walking up from it), so omniweave cannot query it. Use your built-in tools (Read/Grep/Glob) ' +
        "for that codebase instead, and don't call omniweave for it again this session. " +
        "Indexing is the user's decision — they can run 'omniweave init' in that project to enable it."
      );
    }

    // If the path resolves to the default project, reuse the already-open
    // default instance rather than opening a SECOND connection to the same DB.
    // A duplicate connection serializes reads against the watcher's auto-sync
    // writes; on the wasm backend (no WAL) that surfaces as intermittent
    // "database is locked" on concurrent tool calls. See issue #238. The
    // default instance is owned/closed by the server, so it's never cached.
    if (this.cg && this.cg.getProjectRoot() === resolvedRoot) {
      return this.freshen(this.cg);
    }

    const cached = this.projectCache.get(resolvedRoot);
    if (cached) return this.freshen(cached);

    const cg = loadOmniWeave().openSync(resolvedRoot);
    this.projectCache.set(resolvedRoot, cg);
    return cg;
  }

  private freshen(cg: OmniWeave): OmniWeave {
    try {
      if (cg.reopenIfReplaced()) {
        process.stderr.write(
          '[OmniWeave MCP] The index was replaced on disk; reopened the live database in place.\n'
        );
      }
    } catch {
      // Best-effort self-heal. A failed reopen must not break the tool call.
    }
    return cg;
  }

  /**
   * Close all cached project connections
   */
  closeAll(): void {
    for (const cg of this.projectCache.values()) {
      cg.close();
    }
    this.projectCache.clear();
    this.worktreeMismatchCache.clear();
  }

  /**
   * Validate that a value is a non-empty string within length bounds.
   *
   * The `maxLength` cap protects against MCP clients that ship huge
   * payloads (10MB+ query strings either by accident or maliciously).
   * Without this, a single oversized input can pin the FTS5 index or
   * exhaust memory before any real work runs.
   */
  private validateString(
    value: unknown,
    name: string,
    maxLength: number = MAX_INPUT_LENGTH
  ): string | ToolResult {
    if (typeof value !== 'string' || value.length === 0) {
      return this.errorResult(`${name} must be a non-empty string`);
    }
    if (value.length > maxLength) {
      return this.errorResult(
        `${name} exceeds maximum length of ${maxLength} characters (got ${value.length})`
      );
    }
    return value;
  }

  /**
   * Validate an optional path-like string input. Returns the value if
   * valid (or undefined), or a ToolResult with the error.
   */
  private validateOptionalPath(
    value: unknown,
    name: string
  ): string | undefined | ToolResult {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
      return this.errorResult(`${name} must be a string`);
    }
    if (value.length > MAX_PATH_LENGTH) {
      return this.errorResult(
        `${name} exceeds maximum length of ${MAX_PATH_LENGTH} characters (got ${value.length})`
      );
    }
    return value;
  }

  /**
   * Cached git worktree/index mismatch for a tool call's effective project.
   *
   * The "effective project" is what the request targets: an explicit
   * `projectPath` arg, else the directory the server resolved its default
   * project from (`defaultProjectHint`), else cwd. Memoized per start path —
   * see `worktreeMismatchCache`. Best-effort: if the project can't be resolved
   * (e.g. nothing initialized yet), it reports "no mismatch" so a tool is never
   * broken by this check.
   */
  private worktreeMismatchFor(projectPath?: string): WorktreeIndexMismatch | null {
    const startPath = projectPath ?? this.defaultProjectHint ?? process.cwd();
    let indexRoot: string;
    try {
      indexRoot = this.getOmniWeave(projectPath).getProjectRoot();
    } catch {
      // No resolvable project (or any other resolution error) → nothing to warn.
      return null;
    }

    const cacheKey = `${startPath}\0${indexRoot}`;
    const cached = this.worktreeMismatchCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const mismatch = detectWorktreeIndexMismatch(startPath, indexRoot);
    this.worktreeMismatchCache.set(cacheKey, mismatch);
    return mismatch;
  }

  /**
   * Prefix a successful read-tool result with a compact worktree-mismatch
   * notice when the resolved index belongs to a different git working tree than
   * the caller's (issue #155). Without this, an agent in a nested worktree
   * silently trusts main-branch results. No-op on error results and when there
   * is no mismatch. `omniweave_status` is excluded — it embeds its own verbose
   * warning — so it stays out of this path.
   */
  private withWorktreeNotice(result: ToolResult, projectPath?: string): ToolResult {
    if (result.isError) return result;
    const mismatch = this.worktreeMismatchFor(projectPath);
    if (!mismatch) return result;

    const notice = worktreeMismatchNotice(mismatch);
    const [first, ...rest] = result.content;
    if (first && first.type === 'text') {
      return { ...result, content: [{ type: 'text', text: `${notice}\n\n${first.text}` }, ...rest] };
    }
    return result;
  }

  /**
   * Annotate a successful read-tool result with per-file staleness — the
   * non-blocking answer to issue #403. The file watcher tracks every event
   * it sees per path; here we intersect "files referenced in this response"
   * against that pending set and prepend a compact banner so the agent can
   * fall back to Read for those *specific* files without waiting for the
   * debounced sync to fire. Other pending files in the project (not
   * referenced by this response) get a small footer so the agent has a
   * complete picture without bloating the banner.
   *
   * Cost when nothing is pending — the common case — is one boolean check.
   * No I/O, no parsing of markdown beyond a per-pending-file substring scan.
   */
  private withStalenessNotice(
    result: ToolResult,
    projectPath?: string,
    outputSurface: OutputSurface = 'mcp'
  ): ToolResult {
    if (result.isError) return result;

    let cg: OmniWeave;
    try {
      cg = this.getOmniWeave(projectPath);
    } catch {
      return result; // no default project — leave as is
    }

    // Cross-project `projectPath` calls open a cached OmniWeave WITHOUT a
    // watcher (watchers are only attached to the default session project).
    // When the cross-project path happens to be the same project as the
    // default cg, the cached instance is the wrong one — its pendingFiles is
    // permanently empty. Detect the equal-path case and prefer the default
    // cg so the staleness signal still fires when an agent passes the
    // explicit projectPath form of its own project.
    if (this.cg && cg !== this.cg) {
      try {
        const sameProject =
          resolvePath(this.cg.getProjectRoot()) === resolvePath(cg.getProjectRoot());
        if (sameProject) cg = this.cg;
      } catch {
        /* getProjectRoot may throw on a closed instance — leave cg as is */
      }
    }

    const [first, ...rest] = result.content;
    if (!first || first.type !== 'text') return result;
    const text = first.text;

    // Defensive: some test fakes inject a partial OmniWeave stub without the
    // newer pending-files API. Treat missing/throwing as "no pending files."
    let pending: PendingFile[] = [];
    try {
      pending = cg.getPendingFiles?.() ?? [];
    } catch {
      return result;
    }

    if (pending.length > 0) {
      if (isExploreNoResultText(text)) {
        const composed = [formatStaleNoResultNotice(pending, outputSurface), text].join('\n\n');
        return { ...result, content: [{ type: 'text', text: composed }, ...rest] };
      }

      const inResponse: PendingFile[] = [];
      const elsewhere: PendingFile[] = [];
      for (const p of pending) {
        // Substring match against the project-relative POSIX path — that's
        // exactly the format both the watcher and every omniweave response
        // emit, so a plain includes() is sufficient and avoids regex pitfalls.
        if (responseMentionsPath(text, p.path)) inResponse.push(p);
        else elsewhere.push(p);
      }

      let banner = '';
      if (inResponse.length > 0) {
        banner = formatStaleBanner(inResponse, outputSurface);
      }
      let footer = '';
      if (elsewhere.length > 0) {
        footer = formatStaleFooter(elsewhere);
      }
      if (!banner && !footer) return result;

      const composed = [banner, text, footer].filter(Boolean).join('\n\n');
      return { ...result, content: [{ type: 'text', text: composed }, ...rest] };
    }

    // Even an active watcher can miss edits (native fs.watch drops, partial
    // Linux watch coverage, ignored dynamic subtree setup). With no pending
    // events, still reconcile the worktree against the index before declaring
    // the response fresh.
    let changedEntries: ChangedFileEntry[] = [];
    try {
      const changes = cg.getChangedSourceFiles?.() ?? cg.getChangedFiles?.();
      if (changes) changedEntries = changedFileEntries(changes);
    } catch {
      return result;
    }
    changedEntries = changedEntries.filter((entry) =>
      !isLowSignalSourceFile(entry.path) || responseMentionsPath(text, entry.path)
    );
    if (changedEntries.length === 0) return result;

    if (isExploreNoResultText(text)) {
      const composed = [formatChangedIndexNoResultNotice(changedEntries, outputSurface), text].join('\n\n');
      return { ...result, content: [{ type: 'text', text: composed }, ...rest] };
    }

    const inResponse: ChangedFileEntry[] = [];
    const elsewhere: ChangedFileEntry[] = [];
    for (const p of changedEntries) {
      if (responseMentionsPath(text, p.path)) inResponse.push(p);
      else elsewhere.push(p);
    }

    let banner = '';
    if (inResponse.length > 0) {
      banner = formatChangedIndexBanner(inResponse, outputSurface);
    }
    let footer = '';
    if (elsewhere.length > 0) {
      footer = formatChangedIndexFooter(elsewhere);
    }

    if (!banner && !footer) return result;

    const composed = [banner, text, footer].filter(Boolean).join('\n\n');
    return { ...result, content: [{ type: 'text', text: composed }, ...rest] };
  }

  private withSnapshotImportNotice(result: ToolResult, projectPath?: string): ToolResult {
    if (result.isError) return result;

    let cg: OmniWeave;
    try {
      cg = this.getOmniWeave(projectPath);
    } catch {
      return result;
    }

    if (this.cg && cg !== this.cg) {
      try {
        if (resolvePath(this.cg.getProjectRoot()) === resolvePath(cg.getProjectRoot())) {
          cg = this.cg;
        }
      } catch {
        /* closed instance — leave cg as is */
      }
    }

    let snapshotImport;
    try {
      snapshotImport = cg.getSnapshotImportInfo?.() ?? null;
    } catch {
      return result;
    }
    if (!snapshotImport) return result;

    const [first, ...rest] = result.content;
    if (!first || first.type !== 'text') return result;

    const notice = `> ⚠ ${describeSnapshotImportWarning(snapshotImport)}`;
    return { ...result, content: [{ type: 'text', text: `${notice}\n\n${first.text}` }, ...rest] };
  }

  /**
   * Execute a tool by name
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    options: ToolExecutionOptions = {},
  ): Promise<ToolResult> {
    try {
      const outputSurface: OutputSurface = options.outputSurface === 'cli' ? 'cli' : 'mcp';
      // Block the first tool call on the engine's post-open reconcile so we
      // never serve rows for files deleted/edited while no MCP server was
      // running. The gate is cleared after first await — subsequent calls
      // pay nothing. Catch-up failures are logged by the engine; we
      // proceed regardless so a transient sync error never breaks tools.
      if (this.catchUpGate) {
        const gate = this.catchUpGate;
        this.catchUpGate = null;
        try { await gate; } catch { /* engine already logged */ }
      }
      // MCP only: honor the optional tool allowlist defensively even if a
      // client cached tools/list. CLI commands are first-class shell surfaces
      // and must not inherit MCP experiment knobs from the environment.
      if (options.enforceToolAllowlist !== false && !this.isToolAllowed(toolName)) {
        return this.errorResult(`Tool ${toolName} is disabled via OMNIWEAVE_MCP_TOOLS`);
      }
      // Cross-cutting input validation. All tools accept an optional
      // `projectPath` and most accept either `query`, `task`, or
      // `symbol` — bound their lengths centrally so individual handlers
      // can stay focused on tool-specific logic.
      const pathCheck = this.validateOptionalPath(args.projectPath, 'projectPath');
      if (typeof pathCheck === 'object' && pathCheck !== undefined) {
        return pathCheck;
      }
      // The `path` property and omniweave_files' `pattern` glob are
      // path-shaped — apply the same cap. omniweave_search.pattern is raw
      // content text and is bounded by validateString inside handleSearch.
      if (args.path !== undefined) {
        const check = this.validateOptionalPath(args.path, 'path');
        if (typeof check === 'object' && check !== undefined) return check;
      }
      if (toolName === 'omniweave_files' && args.pattern !== undefined) {
        const check = this.validateOptionalPath(args.pattern, 'pattern');
        if (typeof check === 'object' && check !== undefined) return check;
      }

      // Read tools resolve through a single result variable so cross-cutting
      // notices — worktree-index mismatch (issue #155) and per-file
      // staleness (issue #403) — can be applied in one place. status embeds
      // its own verbose worktree warning but still flows through the
      // staleness wrapper so its pending-files section stays consistent
      // with what the read tools surface.
      let result: ToolResult;
      switch (toolName) {
        case 'omniweave_search':
          result = await this.handleSearch(args); break;
        case 'omniweave_callers':
          result = await this.handleCallers(args, outputSurface); break;
        case 'omniweave_callees':
          result = await this.handleCallees(args, outputSurface); break;
        case 'omniweave_impact':
          result = await this.handleImpact(args); break;
        case 'omniweave_explore':
          result = await this.handleExplore(args, outputSurface); break;
        case 'omniweave_node':
          result = await this.handleNode(args, outputSurface); break;
        case 'omniweave_status':
          // status embeds the pending-files list as a first-class section
          // (see handleStatus), so we skip the auto-banner wrapper here to
          // avoid duplicating the same info at the top of the response.
          return await this.handleStatus(args);
        case 'omniweave_files':
          result = await this.handleFiles(args, outputSurface); break;
        default:
          return this.errorResult(`Unknown tool: ${toolName}`);
      }
      const withWorktree = this.withWorktreeNotice(result, args.projectPath as string | undefined);
      const withStaleness = this.withStalenessNotice(withWorktree, args.projectPath as string | undefined, outputSurface);
      const withSnapshotImport = this.withSnapshotImportNotice(withStaleness, args.projectPath as string | undefined);
      if (toolName === 'omniweave_explore') {
        const [first, ...rest] = withSnapshotImport.content;
        if (first && first.type === 'text') {
          return { ...withSnapshotImport, content: [{ type: 'text', text: capExploreFinalText(first.text, outputSurface) }, ...rest] };
        }
      }
      return withSnapshotImport;
    } catch (err) {
      // Expected condition, not a malfunction: answer as a SUCCESS so the
      // agent keeps trusting the toolset for projects that ARE indexed.
      // (An isError here teaches session-long abandonment — see NotIndexedError.)
      if (err instanceof NotIndexedError) {
        return this.textResult(err.message);
      }
      // Security refusal: a clean error, no retry encouragement.
      if (err instanceof PathRefusalError) {
        return this.errorResult(err.message);
      }
      return this.errorResult(
        `Tool execution failed: ${err instanceof Error ? err.message : String(err)}. ` +
        'This is an internal omniweave error — retry the call once; if it persists, ' +
        'continue without omniweave for this task.'
      );
    }
  }

  /**
   * Handle omniweave_search
   */
  private async handleSearch(args: Record<string, unknown>): Promise<ToolResult> {
    const cg = this.getOmniWeave(args.projectPath as string | undefined);
    const rawLimit = Number(args.limit) || 10;
    const limit = clamp(rawLimit, 1, 100);

    // Content-pattern mode: a LITERAL substring over raw file CONTENT (trigram
    // content_fts) — the axis symbol search cannot answer (an error message,
    // a config value, a comment). Prefer `query: "pattern:<literal>"`; accept
    // `pattern` too for programmatic clients that can pass optional fields.
    if (args.pattern !== undefined) {
      const pattern = this.validateString(args.pattern, 'pattern');
      if (typeof pattern !== 'string') return pattern;
      return this.handleContentSearch(cg, pattern, limit);
    }

    const query = this.validateString(args.query, 'query');
    if (typeof query !== 'string') return query;

    const contentPattern = extractContentSearchPattern(query);
    if (contentPattern !== null) return this.handleContentSearch(cg, contentPattern, limit);

    const rawKind = args.kind as string | undefined;
    // The schema enum says 'type' (what agents naturally reach for); the
    // NodeKind is 'type_alias'. Without the mapping, kind: "type" silently
    // matched nothing — a filter value we advertise must work.
    const kind = rawKind === 'type' ? 'type_alias' : rawKind;

    const results = cg.searchNodes(query, {
      limit,
      kinds: kind ? [kind as NodeKind] : undefined,
    });

    if (results.length === 0) {
      return this.textResult(`No results found for "${query}"`);
    }

    // Down-rank generated files within the FTS-returned set so a search
    // for "Send" surfaces the hand-written keeper before .pb.go stubs
    // that share the name. Stable: only reorders generated vs. not.
    const ranked = [...results].sort((a, b) => {
      const aGen = isGeneratedFile(a.node.filePath) ? 1 : 0;
      const bGen = isGeneratedFile(b.node.filePath) ? 1 : 0;
      return aGen - bGen;
    });

    const formatted = this.formatSearchResults(ranked);
    return this.textResult(this.truncateOutput(formatted));
  }

  /**
   * Content-pattern search — literal substring over raw file content (trigram
   * content_fts). Every recoverable state is success-shaped (empty index, too-short
   * pattern, no match are not tool failures). Snippets are escaped: the bytes are
   * untrusted source and could come from an imported snapshot. Honest framing:
   * literal substring only (not regex), and truncation is reported as "has more"
   * because the content FTS query intentionally fetches limit+1, not a full count.
   */
  private handleContentSearch(cg: OmniWeave, pattern: string, limit: number): ToolResult {
    if (pattern.length < 3) {
      return this.textResult(
        `Content search needs at least 3 characters — the content index is trigram-based, so "${escapeContentSnippet(pattern)}" is too short. Add more of the literal string. This is an input limit, not a tool failure.`
      );
    }
    if (cg.contentIndexFileCount() === 0) {
      return this.textResult(
        [
          `No content index yet.`,
          `This project was indexed before file-content search existed (or the content index is empty).`,
          `Re-index the project (a full index/sync) to populate it, then retry the pattern.`,
          `This is an empty index state, not a tool failure.`,
        ].join(' ')
      );
    }
    const { results, hasMore } = cg.searchContent(pattern, limit);
    if (results.length === 0) {
      return this.textResult(
        [
          `No files contain the literal "${escapeContentSnippet(pattern)}".`,
          `This is a literal-substring search (trigram), not regex.`,
          `For a symbol (function/class/variable) use omniweave_search with "query" instead.`,
          `This is an empty retrieval result, not a tool failure.`,
        ].join(' ')
      );
    }
    const shown = hasMore
      ? `showing first ${results.length}; more files match — narrow the pattern or raise limit`
      : `${results.length} file${results.length === 1 ? '' : 's'}`;
    const header = [
      `Files containing the literal "${escapeContentSnippet(pattern)}" (${shown}).`,
      'Substring match, not regex. Raw-content file/snippet hits only; not calls/imports/structural facts.',
    ].join(' ');
    const lines = results.map((r) => {
      const key = `omniweave_node file="${r.path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      return `- ${r.path}\n    snippet: …${escapeContentSnippet(r.snippet)}…\n    key: \`${key}\``;
    });
    return this.textResult(this.truncateOutput([header, ...lines].join('\n')));
  }

  /**
   * Group symbol matches into DISTINCT DEFINITIONS — one group per
   * (filePath, qualifiedName), so same-file overloads stay together while
   * unrelated same-named classes across a monorepo's apps (#764: one
   * `UserService` per NestJS app) are kept apart. Optionally narrowed by a
   * `file` path/suffix first.
   */
  private groupDefinitions(
    nodes: Node[],
    fileFilter: string | undefined
  ): { groups: Node[][]; filteredOut: boolean } {
    let pool = nodes;
    let filteredOut = false;
    if (fileFilter) {
      const narrowed = pool.filter((n) => this.nodeMatchesFileFilter(n, fileFilter));
      if (narrowed.length > 0) {
        pool = narrowed;
      } else {
        filteredOut = true;
      }
    }
    const byDef = new Map<string, Node[]>();
    for (const n of pool) {
      const key = `${n.filePath}|${n.qualifiedName}`;
      const group = byDef.get(key);
      if (group) group.push(n);
      else byDef.set(key, [n]);
    }
    return { groups: [...byDef.values()], filteredOut };
  }

  private nodeMatchesFileFilter(node: Node, fileFilter: string): boolean {
    const wanted = fileFilter.replace(/^\.\//, '');
    return node.filePath === wanted || node.filePath.endsWith(wanted) || node.filePath.endsWith(`/${wanted}`);
  }

  private aggregatedSymbolsNote(symbol: string, nodes: Node[]): string {
    if (nodes.length <= 1) return '';
    const locations = nodes.map((node) => `${node.kind} at ${node.filePath}:${node.startLine}`);
    return `\n\n> **Note:** Aggregated results across ${nodes.length} symbols named "${symbol}": ${locations.join(', ')}`;
  }

  private preferFirstPartyDefinitions(
    matches: { nodes: Node[]; note: string },
    symbol: string,
    fileFilter: string | undefined,
  ): { nodes: Node[]; note: string; omittedLowSignalDefinitions: number } {
    if (matches.nodes.length <= 1) return { ...matches, omittedLowSignalDefinitions: 0 };

    // An explicit file hint is an intentional request to inspect that definition,
    // including research snapshots. If the hint misses entirely, fall back to the
    // ordinary first-party preference below before showing "all definitions".
    if (fileFilter && matches.nodes.some((node) => this.nodeMatchesFileFilter(node, fileFilter))) {
      return { ...matches, omittedLowSignalDefinitions: 0 };
    }

    const firstParty = matches.nodes.filter((node) => !isLowSignalSourceFile(node.filePath));
    if (firstParty.length === 0 || firstParty.length === matches.nodes.length) {
      return { ...matches, omittedLowSignalDefinitions: 0 };
    }

    return {
      nodes: firstParty,
      note: this.aggregatedSymbolsNote(symbol, firstParty),
      omittedLowSignalDefinitions: matches.nodes.length - firstParty.length,
    };
  }

  private lowSignalDefinitionOmissionNote(count: number): string {
    if (count <= 0) return '';
    return `\n\n_Omitted ${count} low-signal same-name definition${count === 1 ? '' : 's'} from test/example/research snapshot sources; pass an explicit file path if that support corpus is the target._`;
  }

  /** Section heading for one distinct definition in grouped output. */
  private definitionHeading(group: Node[], outputSurface: OutputSurface = 'mcp'): string {
    const head = group[0]!;
    const line = head.startLine ? `:${head.startLine}` : '';
    return `### ${head.qualifiedName} (${head.kind}) — ${head.filePath}${line} — ${this.nodeContinuationLabel(head, outputSurface)}`;
  }

  private collectCallSurfaceRelationships(
    cg: OmniWeave,
    defNodes: Node[],
    direction: 'incoming' | 'outgoing',
    options: { collectTestCallers?: boolean } = {},
  ): { nodes: Node[]; testNodes: Node[]; labels: Map<string, string>; omittedLowSignal: number; omittedWeak: number } {
    const seen = new Set<string>();
    const seenTests = new Set<string>();
    const nodes: Node[] = [];
    const testNodes: Node[] = [];
    const labels = new Map<string, string>();
    const definitionIsLowSignal = defNodes.every((node) => isLowSignalSourceFile(node.filePath));
    let omittedLowSignal = 0;
    let omittedWeak = 0;

    for (const node of defNodes) {
      const relationships = direction === 'incoming'
        ? cg.getCallers(node.id)
        : cg.getCallees(node.id);
      for (const relationship of relationships) {
        if (!CALL_SURFACE_EDGE_KINDS.has(relationship.edge.kind)) {
          omittedWeak++;
          continue;
        }
        if (!definitionIsLowSignal && isLowSignalSourceFile(relationship.node.filePath)) {
          if (
            options.collectTestCallers === true
            && direction === 'incoming'
            && !isRepositorySnapshotFile(relationship.node.filePath)
            && isTestFile(relationship.node.filePath)
          ) {
            if (!seenTests.has(relationship.node.id)) {
              seenTests.add(relationship.node.id);
              testNodes.push(relationship.node);
            }
            continue;
          }
          omittedLowSignal++;
          continue;
        }
        if (seen.has(relationship.node.id)) continue;
        seen.add(relationship.node.id);
        nodes.push(relationship.node);
        const label = this.edgeLabel(relationship.edge);
        if (label) labels.set(relationship.node.id, label);
      }
    }

    return { nodes, testNodes, labels, omittedLowSignal, omittedWeak };
  }

  private relationshipOmissionNote(omittedLowSignal: number, omittedWeak: number): string {
    const lines: string[] = [];
    if (omittedLowSignal > 0) {
      lines.push(`_Omitted ${omittedLowSignal} low-signal relationship${omittedLowSignal === 1 ? '' : 's'} from test/example/research snapshot sources; inspect those paths explicitly if that support corpus is the target._`);
    }
    if (omittedWeak > 0) {
      lines.push(`_Omitted ${omittedWeak} non-execution reference/type/import relationship${omittedWeak === 1 ? '' : 's'}; use impact/explore when dependency closure matters._`);
    }
    return lines.length > 0 ? `\n\n${lines.join('\n')}` : '';
  }

  /**
   * Handle omniweave_callers
   */
  private async handleCallers(args: Record<string, unknown>, outputSurface: OutputSurface = 'mcp'): Promise<ToolResult> {
    const symbol = this.validateString(args.symbol, 'symbol');
    if (typeof symbol !== 'string') return symbol;

    const cg = this.getOmniWeave(args.projectPath as string | undefined);
    const limit = clamp((args.limit as number) || 20, 1, 100);
    const fileFilter = typeof args.file === 'string' ? args.file : undefined;

    const allMatches = this.findAllSymbols(cg, symbol);
    if (allMatches.nodes.length === 0) {
      return this.textResult(`Symbol "${symbol}" not found in the codebase`);
    }

    const matches = this.preferFirstPartyDefinitions(allMatches, symbol, fileFilter);
    const definitionOmissionNote = this.lowSignalDefinitionOmissionNote(matches.omittedLowSignalDefinitions);
    const { groups, filteredOut } = this.groupDefinitions(matches.nodes, fileFilter);
    const filterNote = filteredOut
      ? `\n\n> **Note:** no definition of "${symbol}" matches file "${fileFilter}" — showing all definitions instead.`
      : '';

    const collect = (defNodes: Node[]) => this.collectCallSurfaceRelationships(cg, defNodes, 'incoming');

    // Single definition (or same-file overloads): the familiar flat list.
    if (groups.length === 1) {
      const { nodes: callers, labels, omittedLowSignal, omittedWeak } = collect(groups[0]!);
      const omissionNote = this.relationshipOmissionNote(omittedLowSignal, omittedWeak);
      const note = fileFilter && !filteredOut ? '' : matches.note;
      if (callers.length === 0) {
        return this.textResult(`No callers found for "${symbol}"${note}${filterNote}${omissionNote}${definitionOmissionNote}`);
      }
      // A successful `file` narrowing makes the multi-symbol aggregation note
      // stale — suppress it.
      const formatted = this.formatNodeList(callers, `Callers of ${symbol}`, labels, limit, outputSurface) + note + filterNote + omissionNote + definitionOmissionNote;
      return this.textResult(this.truncateOutput(formatted));
    }

    // Multiple DISTINCT definitions (#764): one section per definition so an
    // agent never mistakes one app's callers for another's. Narrow with
    // `file` to focus a single definition.
    const narrowHint = outputSurface === 'cli' ? 'narrow with `--file`' : 'narrow with `file`';
    const lines: string[] = [
      `## Callers of ${symbol} — ${groups.length} distinct definitions (${narrowHint})`,
    ];
    for (const group of groups) {
      const { nodes: callers, labels, omittedLowSignal, omittedWeak } = collect(group);
      lines.push('', this.definitionHeading(group, outputSurface));
      if (callers.length === 0) {
        lines.push('- (no callers)');
      } else {
        for (const node of callers.slice(0, limit)) {
          const location = node.startLine ? `:${node.startLine}` : '';
          const label = labels.get(node.id);
          lines.push(`- ${this.callerDisplayName(node)} (${node.kind}) - ${node.filePath}${location}${label ? ` — via ${label}` : ''} — ${this.nodeContinuationLabel(node, outputSurface)}`);
        }
        if (callers.length > limit) lines.push(this.moreResultsNote(callers.length, limit, outputSurface));
      }
      const omissionNote = this.relationshipOmissionNote(omittedLowSignal, omittedWeak);
      if (omissionNote) lines.push(omissionNote.trim());
    }
    return this.textResult(this.truncateOutput(lines.join('\n') + filterNote + definitionOmissionNote));
  }

  /**
   * Handle omniweave_callees
   */
  private async handleCallees(args: Record<string, unknown>, outputSurface: OutputSurface = 'mcp'): Promise<ToolResult> {
    const symbol = this.validateString(args.symbol, 'symbol');
    if (typeof symbol !== 'string') return symbol;

    const cg = this.getOmniWeave(args.projectPath as string | undefined);
    const limit = clamp((args.limit as number) || 20, 1, 100);
    const fileFilter = typeof args.file === 'string' ? args.file : undefined;

    const allMatches = this.findAllSymbols(cg, symbol);
    if (allMatches.nodes.length === 0) {
      return this.textResult(`Symbol "${symbol}" not found in the codebase`);
    }

    const matches = this.preferFirstPartyDefinitions(allMatches, symbol, fileFilter);
    const definitionOmissionNote = this.lowSignalDefinitionOmissionNote(matches.omittedLowSignalDefinitions);
    const { groups, filteredOut } = this.groupDefinitions(matches.nodes, fileFilter);
    const filterNote = filteredOut
      ? `\n\n> **Note:** no definition of "${symbol}" matches file "${fileFilter}" — showing all definitions instead.`
      : '';

    const collect = (defNodes: Node[]) => this.collectCallSurfaceRelationships(cg, defNodes, 'outgoing');

    if (groups.length === 1) {
      const { nodes: callees, labels, omittedLowSignal, omittedWeak } = collect(groups[0]!);
      const omissionNote = this.relationshipOmissionNote(omittedLowSignal, omittedWeak);
      const note = fileFilter && !filteredOut ? '' : matches.note;
      if (callees.length === 0) {
        return this.textResult(`No callees found for "${symbol}"${note}${filterNote}${omissionNote}${definitionOmissionNote}`);
      }
      // A successful `file` narrowing makes the multi-symbol aggregation note
      // stale — suppress it.
      const formatted = this.formatNodeList(callees, `Callees of ${symbol}`, labels, limit, outputSurface) + note + filterNote + omissionNote + definitionOmissionNote;
      return this.textResult(this.truncateOutput(formatted));
    }

    // Multiple DISTINCT definitions (#764): per-definition sections.
    const narrowHint = outputSurface === 'cli' ? 'narrow with `--file`' : 'narrow with `file`';
    const lines: string[] = [
      `## Callees of ${symbol} — ${groups.length} distinct definitions (${narrowHint})`,
    ];
    for (const group of groups) {
      const { nodes: callees, labels, omittedLowSignal, omittedWeak } = collect(group);
      lines.push('', this.definitionHeading(group, outputSurface));
      if (callees.length === 0) {
        lines.push('- (no callees)');
      } else {
        for (const node of callees.slice(0, limit)) {
          const location = node.startLine ? `:${node.startLine}` : '';
          const label = labels.get(node.id);
          lines.push(`- ${this.callerDisplayName(node)} (${node.kind}) - ${node.filePath}${location}${label ? ` — via ${label}` : ''} — ${this.nodeContinuationLabel(node, outputSurface)}`);
        }
        if (callees.length > limit) lines.push(this.moreResultsNote(callees.length, limit, outputSurface));
      }
      const omissionNote = this.relationshipOmissionNote(omittedLowSignal, omittedWeak);
      if (omissionNote) lines.push(omissionNote.trim());
    }
    return this.textResult(this.truncateOutput(lines.join('\n') + filterNote + definitionOmissionNote));
  }

  /**
   * Handle omniweave_impact
   */
  private async handleImpact(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = this.validateString(args.symbol, 'symbol');
    if (typeof symbol !== 'string') return symbol;

    const cg = this.getOmniWeave(args.projectPath as string | undefined);
    const depth = clamp((args.depth as number) || 2, 1, 10);
    const fileFilter = typeof args.file === 'string' ? args.file : undefined;

    const allMatches = this.findAllSymbols(cg, symbol);
    if (allMatches.nodes.length === 0) {
      return this.textResult(`Symbol "${symbol}" not found in the codebase`);
    }

    const matches = this.preferFirstPartyDefinitions(allMatches, symbol, fileFilter);
    const definitionOmissionNote = this.lowSignalDefinitionOmissionNote(matches.omittedLowSignalDefinitions);
    const { groups, filteredOut } = this.groupDefinitions(matches.nodes, fileFilter);
    const filterNote = filteredOut
      ? `\n\n> **Note:** no definition of "${symbol}" matches file "${fileFilter}" — showing all definitions instead.`
      : '';

    const impactOf = (defNodes: Node[]): Subgraph => {
      const mergedNodes = new Map<string, Node>();
      const mergedEdges: Edge[] = [];
      const seenEdges = new Set<string>();
      let truncated = false;
      let deeperCount = 0;
      for (const node of defNodes) {
        const impact = cg.getImpactRadius(node.id, depth);
        for (const [id, n] of impact.nodes) {
          mergedNodes.set(id, n);
        }
        for (const e of impact.edges) {
          const key = `${e.source}->${e.target}:${e.kind}`;
          if (!seenEdges.has(key)) {
            seenEdges.add(key);
            mergedEdges.push(e);
          }
        }
        if (impact.truncated) truncated = true;
        deeperCount += impact.deeperCount ?? 0;
      }
      return { nodes: mergedNodes, edges: mergedEdges, roots: defNodes.map((n) => n.id), truncated, deeperCount };
    };

    // Single definition (or same-file overloads): the familiar merged report.
    if (groups.length === 1) {
      const formatted = this.formatImpact(symbol, impactOf(groups[0]!), depth) + (fileFilter && !filteredOut ? "" : matches.note) + filterNote + definitionOmissionNote;
      return this.textResult(this.truncateOutput(formatted));
    }

    // Multiple DISTINCT definitions (#764): a blast radius PER definition —
    // merging unrelated same-named classes (one UserService per monorepo app)
    // overstated impact and confused agents. Narrow with `file`.
    const sections: string[] = [
      `## Impact of ${symbol} — ${groups.length} distinct definitions (each with its own blast radius; narrow with \`file\`)`,
    ];
    for (const group of groups) {
      const head = group[0]!;
      const line = head.startLine ? `:${head.startLine}` : '';
      sections.push(
        '',
        this.formatImpact(`${head.qualifiedName} (${head.filePath}${line})`, impactOf(group), depth)
      );
    }
    return this.textResult(this.truncateOutput(sections.join('\n') + filterNote + definitionOmissionNote));
  }

  /**
   * Describe a synthesized (dynamic-dispatch) edge for human output: how the
   * callback was wired up — the bridge static parsing can't see. Returns null
   * for ordinary static edges. Used by trace + the node trail so a synthesized
   * hop reads as "registered via onUpdate at App.tsx:3148", not a bare arrow.
   */
  private synthEdgeNote(edge: Edge | null): { label: string; compact: string; registeredAt?: string } | null {
    if (!edge || edge.provenance !== 'heuristic') return null;
    const m = edge.metadata as Record<string, unknown> | undefined;
    const registeredAt = typeof m?.registeredAt === 'string' ? m.registeredAt : undefined;
    const at = registeredAt ? ` @${registeredAt}` : '';
    if (m?.synthesizedBy === 'callback') {
      const via = m.via ? `\`${String(m.via)}\`` : 'a registrar';
      const field = m.field ? ` on .${String(m.field)}` : '';
      return {
        label: `callback — registered via ${via}${field} (dynamic dispatch)`,
        compact: `dynamic: callback via ${via}${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'event-emitter') {
      const ev = m.event ? `\`${String(m.event)}\`` : 'an event';
      return {
        label: `event ${ev} — emit → handler (dynamic dispatch)`,
        compact: `dynamic: event ${ev}${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'react-render') {
      return {
        label: `React re-render — \`setState\` re-runs render() (dynamic dispatch)`,
        compact: `dynamic: React re-render via setState${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'jsx-render') {
      const child = m.via ? `<${String(m.via)}>` : 'a child component';
      return {
        label: `renders ${child} (JSX child — dynamic dispatch)`,
        compact: `dynamic: renders ${child}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'vue-handler') {
      const ev = m.event ? `@${String(m.event)}` : 'a template event';
      return {
        label: `Vue template handler — bound to ${ev} (dynamic dispatch)`,
        compact: `dynamic: Vue ${ev} handler`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'pinia-store') {
      const action = m.via ? `\`${String(m.via)}\`` : 'an action';
      return {
        label: `Pinia store action ${action} (dynamic dispatch)`,
        compact: `dynamic: Pinia action ${action}${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'vuex-dispatch') {
      const action = m.via ? `\`${String(m.via)}\`` : 'an action';
      return {
        label: `Vuex store dispatch ${action} (dynamic dispatch)`,
        compact: `dynamic: Vuex dispatch ${action}${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'zustand-store') {
      const action = m.via ? `\`${String(m.via)}\`` : 'an action';
      return {
        label: `Zustand store action ${action} (dynamic dispatch)`,
        compact: `dynamic: Zustand action ${action}${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'interface-impl') {
      return {
        label: `interface/abstract dispatch — runs the implementation override (dynamic dispatch)`,
        compact: `dynamic: interface → impl${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'closure-collection') {
      const field = m.field ? `\`${String(m.field)}\`` : 'a collection';
      return {
        label: `closure collection — runs handlers appended to ${field} (dynamic dispatch)`,
        compact: `dynamic: runs ${field} handlers${at}`,
        registeredAt,
      };
    }
    if (m?.synthesizedBy === 'goframe-route') {
      const route = m.route ? `\`${String(m.route)}\`` : 'a route';
      return {
        label: `GoFrame route ${route} — reflective Bind → controller method (dynamic dispatch)`,
        compact: `dynamic: GoFrame route ${m.route ? String(m.route) : ''}${at}`,
        registeredAt,
      };
    }
    if (typeof m?.synthesizedBy === 'string') {
      const kind = m.synthesizedBy.replace(/-/g, ' ');
      return {
        label: `${kind} (dynamic dispatch)`,
        compact: `dynamic: ${kind}${at}`,
        registeredAt,
      };
    }
    return null;
  }

  /**
   * Flow-from-named-symbols: an agent's omniweave_explore query is a bag of
   * symbol names that usually spans the flow it's investigating (e.g.
   * "PmsProductController getList PmsProductService list PmsProductServiceImpl").
   * Surface the longest call chain AMONG those named symbols — scoped to what the
   * agent explicitly named, so (unlike a fuzzy relevance set) there's no
   * wrong-feature wandering. Rides synthesized edges, so controller→service-
   * interface→impl shows up. Returns '' if no chain of >=3 nodes exists.
   *
   * Ambiguous tokens (Java `list` → dozens of nodes) are disambiguated by
   * CO-NAMING: the agent names the class too, so we keep only `list` candidates
   * whose qualifiedName contains another named token (`PmsProductServiceImpl::list`),
   * dropping unrelated `OmsOrderService::list`.
   */
  private buildFlowFromNamedSymbols(cg: OmniWeave, query: string, outputSurface: OutputSurface = 'mcp'): { text: string; pathNodeIds: Set<string>; namedNodeIds: Set<string>; uniqueNamedNodeIds: Set<string> } {
    const EMPTY = { text: '', pathNodeIds: new Set<string>(), namedNodeIds: new Set<string>(), uniqueNamedNodeIds: new Set<string>() };
    try {
      const CALLABLE = new Set(['method', 'function', 'component', 'constructor']);
      const tokens = extractExploreNameTokens(query, { includePrecedingPlainTokens: true });
      if (tokens.length < 2) return EMPTY;
      // Pool of name SEGMENTS (Class + method from every token) used to
      // disambiguate an ambiguous SIMPLE name: keep a candidate only if its
      // CONTAINER class is itself named in the query.
      const segPool = new Set<string>();
      for (const t of tokens) for (const s of t.toLowerCase().split(/::|\./)) if (s) segPool.add(s);
      const allowLowSignalSeeds = queryAllowsLowSignalSources(query);
      const named = new Map<string, Node>();
      // Nodes whose token is SPECIFIC — a (near-)unique callable name (<=3 defs in
      // the whole graph). These are safe to SPARE a file on: the agent named THIS
      // method (`getResponseWithInterceptorChain`, 1 def). A hyper-polymorphic name
      // (`as_sql`, 110 defs across every Expression/Compiler subclass) is NOT here,
      // so naming it doesn't keep every backend variant full and flood the budget.
      const uniqueNamedNodeIds = new Set<string>();
      // token → resolved node ids: drives the token-coverage check that gates
      // the dynamic-boundary scan (a token is covered when ANY of its nodes
      // lands on the main chain — overloads off the chain don't count against).
      const tokenNodes = new Map<string, string[]>();
      for (const t of tokens) {
        const cands = this.findAllSymbols(cg, t).nodes.filter((n) =>
          CALLABLE.has(n.kind) && (allowLowSignalSeeds || !isLowSignalSourceFile(n.filePath))
        );
        // A qualified or otherwise-specific name (<=3 hits) keeps all; an
        // ambiguous simple name keeps only candidates whose container is named.
        const specific = cands.length <= 3;
        const pick = specific
          ? cands
          : cands.filter((n) => {
              const segs = (n.qualifiedName || '').toLowerCase().split(/::|\./).filter(Boolean);
              const container = segs.length >= 2 ? segs[segs.length - 2] : '';
              return !!container && segPool.has(container);
            });
        const kept = pick.slice(0, 6);
        tokenNodes.set(t, kept.map((n) => n.id));
        for (const n of kept) {
          named.set(n.id, n);
          if (specific) uniqueNamedNodeIds.add(n.id);
        }
        if (named.size > 40) break;
      }
      if (named.size < 2) {
        // The agent named a flow but only one side resolved (the other end is
        // anonymous / runtime-registered / not extracted). The resolved side's
        // body may still hold the dynamic-dispatch site that EXPLAINS the gap —
        // surface that instead of silently returning nothing.
        if (named.size === 0) return EMPTY;
        const boundaries = this.buildDynamicBoundaries(cg, [...named.values()], named, outputSurface);
        if (!boundaries) return EMPTY;
        const text = boundaries + '> Full source for these symbols is below.\n';
        return { text, pathNodeIds: new Set(), namedNodeIds: new Set(named.keys()), uniqueNamedNodeIds };
      }
      const MAX_HOPS = 7;
      let best: Array<{ node: Node; edge: Edge | null }> | null = null;
      // BFS the full call graph (incl. synth edges) from each named seed, but
      // only ACCEPT a sink that is also named — both ends anchored to symbols the
      // agent named, so the chain stays on-topic while bridging intermediates
      // (e.g. the exact interface overload) that the token resolution missed.
      for (const seed of [...named.values()].slice(0, 8)) {
        const parent = new Map<string, { prev: string | null; edge: Edge | null; node: Node }>();
        parent.set(seed.id, { prev: null, edge: null, node: seed });
        const q: Array<{ id: string; depth: number; streak: number }> = [{ id: seed.id, depth: 0, streak: 0 }];
        let deep: string | null = null, deepDepth = 0;
        const MAX_BRIDGE = 2; // Bridge short endpoint queries (entry -> helper -> helper -> sink) without wandering fan-out.
        for (let h = 0; h < q.length && parent.size < 1500; h++) {
          const { id, depth, streak } = q[h]!;
          if (id !== seed.id && named.has(id) && depth > deepDepth) { deep = id; deepDepth = depth; }
          if (depth >= MAX_HOPS - 1) continue;
          for (const c of cg.getCallees(id)) {
            if (!CALL_SURFACE_EDGE_KINDS.has(c.edge.kind) || parent.has(c.node.id)) continue;
            const newStreak = named.has(c.node.id) ? 0 : streak + 1;
            if (newStreak > MAX_BRIDGE) continue;
            parent.set(c.node.id, { prev: id, edge: c.edge, node: c.node });
            q.push({ id: c.node.id, depth: depth + 1, streak: newStreak });
          }
        }
        if (!deep) continue;
        const chain: Array<{ node: Node; edge: Edge | null }> = [];
        let cur: string | null = deep;
        while (cur) { const p = parent.get(cur); if (!p) break; chain.push({ node: p.node, edge: p.edge }); cur = p.prev; }
        chain.reverse();
        if (!best || chain.length > best.length) best = chain;
      }
      const hasMain = !!best && best.length >= 3;
      const pathIds = new Set((best ?? []).map((s) => s.node.id));

      // Dynamic-boundary scan (#687) — fires ONLY when the flow the agent
      // asked about did not fully connect: some token resolved to nodes but
      // none of them sit on the main chain (or there is no chain at all). A
      // healthy flow skips this entirely. Scan order: the chain's dead end
      // first (where the partial flow stops), then the disconnected symbols,
      // agent-specific (unique-named) ones first.
      let boundaryText = '';
      {
        const uncovered: Node[] = [];
        if (!hasMain) {
          // No rendered chain — but a 2-node chain still CONNECTS its two
          // endpoints (e.g. via one synthesized hop, surfaced below as a
          // dynamic-dispatch link). Only nodes off that short chain are
          // unexplained breaks worth scanning.
          for (const n of named.values()) if (!pathIds.has(n.id)) uncovered.push(n);
        } else {
          for (const ids of tokenNodes.values()) {
            if (ids.length === 0 || ids.some((id) => pathIds.has(id))) continue;
            for (const id of ids) { const n = named.get(id); if (n) uncovered.push(n); }
          }
        }
        if (uncovered.length > 0) {
          const scanList: Node[] = [];
          if (hasMain) scanList.push(best![best!.length - 1]!.node);
          scanList.push(...uncovered.sort((a, b) =>
            (uniqueNamedNodeIds.has(b.id) ? 1 : 0) - (uniqueNamedNodeIds.has(a.id) ? 1 : 0)));
          boundaryText = this.buildDynamicBoundaries(cg, scanList, named, outputSurface);
        }
      }

      // Supplementary: dynamic-dispatch (synthesized) edges incident to a NAMED
      // symbol — the indirect hops an agent would otherwise grep/Read to
      // reconstruct ("where do the appended `validators` actually run?"). The
      // synth edge IS that answer, so surface it even when the OTHER end wasn't
      // named (e.g. the agent names `validate` but not the `didCompleteTask`
      // that drains the collection). On-topic by construction: only heuristic
      // edges touching a symbol the agent named; skipped when the hop already
      // shows in the main chain.
      const synthLines: string[] = [];
      const synthSeen = new Set<string>();
      for (const n of named.values()) {
        if (synthLines.length >= 6) break;
        for (const { node: other, edge } of [...cg.getCallers(n.id), ...cg.getCallees(n.id)]) {
          if (synthLines.length >= 6) break;
          if (edge.provenance !== 'heuristic' || other.id === n.id) continue;
          // "Already in the main chain" only applies when a chain RENDERS
          // (hasMain). A 2-node chain populates pathIds but renders nothing,
          // so a direct synthesized hop between two named symbols (custom
          // EventBus emit→handler, #687) was invisible — too short for Flow,
          // skipped here as in-chain. Surface it.
          if (hasMain && pathIds.has(edge.source) && pathIds.has(edge.target)) continue;
          const src = edge.source === n.id ? n : other;
          const tgt = edge.source === n.id ? other : n;
          const key = `${src.name}>${tgt.name}`;
          if (synthSeen.has(key)) continue;
          synthSeen.add(key);
          const note = this.synthEdgeNote(edge);
          synthLines.push(`- ${src.name} → ${tgt.name}   [${note ? note.compact : edge.kind}]`);
        }
      }

      if (!hasMain && synthLines.length === 0 && !boundaryText) return EMPTY;
      const out: string[] = [];
      if (hasMain) {
        out.push('## Flow (call path among the symbols you queried)', '');
        for (let i = 0; i < best!.length; i++) {
          const step = best![i]!;
          if (step.edge) { const sy = this.synthEdgeNote(step.edge); out.push(`   ↓ ${sy ? sy.compact : step.edge.kind}`); }
          out.push(`${i + 1}. ${step.node.name} (${step.node.filePath}:${step.node.startLine})`);
        }
        out.push('');
      }
      if (synthLines.length) {
        out.push(
          '## Dynamic-dispatch links among your symbols',
          '(synthesized — the indirect hops grep/Read would reconstruct; the `@file:line` is the wiring site)',
          '',
          ...synthLines,
          ''
        );
      }
      if (boundaryText) out.push(boundaryText);
      out.push('> Full source for these symbols is below — the call flow among them, followed by their bodies.', '');
      // namedNodeIds = every callable the agent explicitly named (a superset of
      // the spine). A file holding one is something the agent asked to SEE, so it
      // must keep full source even if it's an off-spine polymorphic sibling — the
      // agent named `getResponseWithInterceptorChain` / `SQLCompiler.execute_sql`
      // as the mechanism, not as an interchangeable leaf. See the skeleton gate.
      return { text: out.join('\n'), pathNodeIds: pathIds, namedNodeIds: new Set(named.keys()), uniqueNamedNodeIds };
    } catch {
      return EMPTY;
    }
  }

  /**
   * Dynamic-boundary surfacing (#687): when the flow among the agent's named
   * symbols does not fully connect, scan the disconnected symbols' bodies for
   * dynamic-dispatch sites (computed member calls, getattr, reflection, typed
   * message buses, runtime-keyed emits) and ANNOUNCE the boundary — the exact
   * site, the form, and (when a key is statically visible) candidate targets —
   * instead of guessing edges. The answer to "how does A reach B" when no
   * static path exists IS the dispatch site: that's where the flow continues
   * at runtime. Query-time, deterministic, zero graph mutation; a fully
   * connected flow never reaches this method.
   */
  private buildDynamicBoundaries(cg: OmniWeave, scanList: Node[], named: Map<string, Node>, outputSurface: OutputSurface = 'mcp'): string {
    const MAX_NOTES = 4;       // boundary bullets per explore
    const MAX_SCAN = 8;        // bodies scanned
    const MAX_TOTAL_CHARS = 200_000;
    let projectRoot: string;
    try { projectRoot = cg.getProjectRoot(); } catch { return ''; }
    const notes: string[] = [];
    const seenNode = new Set<string>();
    const seenSite = new Set<string>();
    let scanned = 0, charsScanned = 0;
    for (const node of scanList) {
      if (notes.length >= MAX_NOTES || scanned >= MAX_SCAN || charsScanned > MAX_TOTAL_CHARS) break;
      if (seenNode.has(node.id) || !node.startLine || !node.endLine) continue;
      seenNode.add(node.id);
      const absPath = validatePathWithinRoot(projectRoot, node.filePath);
      if (!absPath || !existsSync(absPath)) continue;
      let content: string;
      try { content = readFileSync(absPath, 'utf-8'); } catch { continue; }
      const body = content.split('\n').slice(node.startLine - 1, node.endLine).join('\n');
      scanned++;
      charsScanned += body.length;
      for (const m of scanDynamicDispatch(body, node.language || '', node.startLine)) {
        if (notes.length >= MAX_NOTES) break;
        const siteKey = `${node.filePath}:${m.line}:${m.form}`;
        if (seenSite.has(siteKey)) continue;
        seenSite.add(siteKey);
        const more = m.moreSites ? ` (+${m.moreSites} more such site${m.moreSites > 1 ? 's' : ''} in this body)` : '';
        notes.push(`- \`${node.name}\` (${node.filePath}:${m.line}) — ${m.label}: \`${m.snippet}\`${more}`);
        if (m.key) {
          const cand = this.boundaryCandidates(cg, m.key, !!m.keyIsType, named, node.id);
          if (cand) notes.push(`  ${cand}`);
        }
      }
    }
    if (notes.length === 0) return '';
    return [
      '## Dynamic boundaries (the static path ends at runtime dispatch)',
      '',
      ...notes,
      '',
      outputSurface === 'cli'
        ? '> These sites choose their call target at runtime (registry / bus / reflection) — the site shown IS where the flow continues. To follow it, run `omniweave explore "<candidate>"` or `omniweave node "<candidate>"`; source for the sites above is included below.'
        : '> These sites choose their call target at runtime (registry / bus / reflection) — the site shown IS where the flow continues. To follow it, run omniweave_explore or omniweave_node on a candidate; source for the sites above is included below.',
      '',
    ].join('\n');
  }

  /**
   * Shortlist candidate runtime targets for a dispatch key surfaced by
   * {@link buildDynamicBoundaries}. Exact conventional names first (`save` →
   * `onSave`/`handleSave`; `CreateCmd` → `CreateCmdHandler`), then FTS, with a
   * normalized-containment post-filter (FTS camel-splitting is fuzzier than a
   * candidate list should be). Symbols the agent already named sort first and
   * are marked — that's the "you were right, here's the wiring" case.
   */
  private boundaryCandidates(cg: OmniWeave, key: string, keyIsType: boolean, named: Map<string, Node>, selfId: string): string {
    const CALLABLE = new Set(['method', 'function', 'component', 'constructor', 'class']);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const keyNorm = norm(key);
    if (keyNorm.length < 3) return '';
    const cands = new Map<string, Node>();
    const consider = (n: Node | undefined | null) => {
      if (!n || n.id === selfId || !CALLABLE.has(n.kind) || cands.has(n.id)) return;
      const nameNorm = norm(n.name || '');
      if (nameNorm.length < 3) return;
      if (!nameNorm.includes(keyNorm) && !keyNorm.includes(nameNorm)) return;
      cands.set(n.id, n);
    };
    const cap = key.charAt(0).toUpperCase() + key.slice(1);
    const probes = keyIsType
      ? [`${key}Handler`, key]
      : [key, `on${cap}`, `handle${cap}`, `${key}Handler`, `handle_${key}`];
    for (const p of probes) {
      try { for (const n of cg.getNodesByName(p)) consider(n); } catch { /* exact probe miss is fine */ }
    }
    let raw = 0;
    try {
      const results = cg.searchNodes(key, { limit: 12 });
      raw = results.length;
      for (const r of results) consider(r.node);
    } catch { /* FTS syntax edge — exact probes already ran */ }
    if (cands.size === 0) {
      return raw >= 12 && key.length < 5 ? `key \`${key}\` is too generic to shortlist (${raw}+ matches)` : '';
    }
    // A constructor candidate duplicates its class: extractors emit ctors as
    // METHOD nodes named like the class (C#/Java `Foo::Foo`) — keep the class.
    const all = [...cands.values()];
    const classKey = new Set(all.filter((n) => n.kind === 'class').map((n) => `${n.name}|${n.filePath}`));
    const namedNames = new Set([...named.values()].map((n) => n.name));
    const isNamed = (n: Node) => named.has(n.id) || namedNames.has(n.name); // the flow's named set holds callables only — transfer the mark to the class
    const list = all
      .filter((n) => !(n.kind !== 'class' && classKey.has(`${n.name}|${n.filePath}`)))
      .sort((a, b) => (isNamed(b) ? 1 : 0) - (isNamed(a) ? 1 : 0))
      .slice(0, 4)
      .map((n) => {
        // Typed-bus convention: the runtime target is the candidate class's
        // Handle/Execute/Consume method — name the exact node, not just the class.
        let display = n.qualifiedName || n.name;
        let at = `${n.filePath}:${n.startLine}`;
        if (keyIsType && n.kind === 'class') {
          try {
            const HANDLER_METHODS = /^(handle|handleAsync|execute|executeAsync|consume|consumeAsync|run|__invoke)$/i;
            const method = cg.getOutgoingEdges(n.id)
              .filter((e) => e.kind === 'contains')
              .map((e) => { try { return cg.getNode(e.target); } catch { return null; } })
              .find((c): c is Node => !!c && c.kind === 'method' && HANDLER_METHODS.test(c.name));
            if (method) { display = `${n.name}.${method.name}`; at = `${method.filePath}:${method.startLine}`; }
          } catch { /* class without resolvable members — show the class itself */ }
        }
        return `\`${display}\` (${at})${isNamed(n) ? ' ← you named this' : ''}`;
      });
    return `candidates for key \`${key}\`: ${list.join(', ')}`;
  }

  /**
   * Compact "blast radius" for the entry symbols of an explore result: who
   * depends on each (callers) and which test files cover it — LOCATIONS ONLY,
   * no source, so the agent knows what to update / re-verify before editing
   * without reaching for a separate impact call. Always-on, but skips symbols
   * that have no dependents (nothing to warn about), and returns '' when none
   * qualify so a leaf-only exploration stays clean.
   */
  private buildBlastRadiusSection(cg: OmniWeave, subgraph: Subgraph): string {
    const ROOT_CAP = 5; // only the symbols the query actually targeted
    const FILE_CAP = 4; // caller files listed per symbol before "+N more"
    const MEANINGFUL = new Set<string>([
      'function', 'method', 'class', 'interface', 'struct', 'trait', 'protocol',
      'enum', 'type_alias', 'component', 'constant', 'variable', 'property', 'field',
    ]);
    const rel = (p: string) => p.replace(/\\/g, '/');

    const roots = subgraph.roots
      .map((id) => subgraph.nodes.get(id))
      .filter((n): n is Node => !!n && MEANINGFUL.has(n.kind))
      .slice(0, ROOT_CAP);
    if (roots.length === 0) return '';

    const entries: string[] = [];
    for (const root of roots) {
      let callers: Node[] = [];
      let testCallers: Node[] = [];
      let omittedLowSignal = 0;
      let omittedWeak = 0;
      try {
        const collected = this.collectCallSurfaceRelationships(cg, [root], 'incoming', { collectTestCallers: true });
        callers = collected.nodes;
        testCallers = collected.testNodes;
        omittedLowSignal = collected.omittedLowSignal;
        omittedWeak = collected.omittedWeak;
      } catch { /* skip this root */ }

      const seen = new Set<string>();
      const uniq: Node[] = [];
      for (const caller of callers) {
        if (!seen.has(caller.id)) { seen.add(caller.id); uniq.push(caller); }
      }
      const testSeen = new Set<string>();
      const uniqTests: Node[] = [];
      for (const caller of testCallers) {
        if (!testSeen.has(caller.id)) { testSeen.add(caller.id); uniqTests.push(caller); }
      }
      if (uniq.length === 0 && uniqTests.length === 0) continue; // no blast radius → nothing to flag

      const callerFiles = [...new Set(uniq.map((n) => rel(n.filePath)))];
      const testFiles = [...new Set(uniqTests.map((n) => rel(n.filePath)))];
      const nonTest = callerFiles;

      const shown = nonTest.slice(0, FILE_CAP).map((f) => `\`${f}\``).join(', ');
      const more = nonTest.length > FILE_CAP ? ` +${nonTest.length - FILE_CAP} more` : '';
      const where = nonTest.length > 0 ? ` in ${shown}${more}` : '';
      const tests = testFiles.length > 0
        ? `; tests: ${testFiles.slice(0, FILE_CAP).map((f) => `\`${f}\``).join(', ')}${testFiles.length > FILE_CAP ? ` +${testFiles.length - FILE_CAP}` : ''}`
        : '; ⚠️ no direct test callers found';
      const omitted = [
        omittedLowSignal > 0 ? `${omittedLowSignal} low-signal` : '',
        omittedWeak > 0 ? `${omittedWeak} non-execution` : '',
      ].filter(Boolean).join(' + ');
      const omittedNote = omitted ? `; omitted ${omitted} relationship${omittedLowSignal + omittedWeak === 1 ? '' : 's'} from call-surface count` : '';

      entries.push(
        `- \`${root.name}\` (${rel(root.filePath)}:${root.startLine}) — ${uniq.length} production caller${uniq.length === 1 ? '' : 's'}${where}${tests}${omittedNote}`,
      );
    }
    if (entries.length === 0) return '';

    return [
      '### Blast radius — what depends on these (update/verify before editing)',
      '',
      ...entries,
      '',
    ].join('\n');
  }

  /**
   * Graph-connectivity relevance via Random-Walk-with-Restart (personalized
   * PageRank) from the query's matched SEED nodes over the call/reference graph.
   *
   * This is the ranking signal text search (FTS/bm25) CANNOT provide, and it's
   * omniweave's home turf: relevance by STRUCTURE, not words. A file whose
   * symbols are call-connected to the matched cluster accrues walk mass and
   * ranks high; a lone TEXT match — e.g. `LensSwitcher.swift` matched the word
   * "switch" from `switchOrganization`, but calls none of `setUser`/`fetchUser`
   * — gets only its own restart probability and ranks ~0. Immune to the
   * tokenization trap that fools term matching, deterministic, no embeddings.
   *
   * Undirected adjacency (reachability both ways), restart α=0.25 to the seeds,
   * power iteration to convergence. Bounded to the already-relevant subgraph, so
   * it's a few hundred nodes × ~25 iterations — negligible cost.
   */
  private computeGraphRelevance(
    nodeIds: string[],
    edges: Edge[],
    seedIds: Set<string>,
  ): Map<string, number> {
    const out = new Map<string, number>();
    const n = nodeIds.length;
    if (n === 0) return out;
    const idx = new Map<string, number>();
    for (let i = 0; i < n; i++) idx.set(nodeIds[i]!, i);

    const RANK_EDGES = new Set<string>([
      'calls', 'references', 'extends', 'implements', 'overrides',
      'instantiates', 'returns', 'type_of', 'imports', 'crossLang', 'produces', 'consumes', 'invokes',
    ]);
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (const e of edges) {
      if (!RANK_EDGES.has(e.kind)) continue;
      const i = idx.get(e.source);
      const j = idx.get(e.target);
      if (i === undefined || j === undefined || i === j) continue;
      adj[i]!.push(j);
      adj[j]!.push(i); // undirected — reachable either direction
    }

    // Restart vector: uniform over seeds present in the candidate set. (Falls
    // back to uniform-over-all if no seed landed in the set, so we never return
    // all-zero.)
    const r = new Array<number>(n).fill(0);
    let rsum = 0;
    for (const id of seedIds) {
      const i = idx.get(id);
      if (i !== undefined) { r[i] = 1; rsum += 1; }
    }
    if (rsum === 0) { for (let i = 0; i < n; i++) r[i] = 1; rsum = n; }
    for (let i = 0; i < n; i++) r[i]! /= rsum;

    const alpha = 0.25;
    let s = r.slice();
    for (let iter = 0; iter < 25; iter++) {
      const next = new Array<number>(n).fill(0);
      for (let i = 0; i < n; i++) {
        const si = s[i]!;
        if (si === 0) continue;
        const d = adj[i]!.length;
        if (d === 0) { next[i]! += si; continue; } // dangling: keep its mass
        const share = si / d;
        for (const j of adj[i]!) next[j]! += share;
      }
      for (let i = 0; i < n; i++) s[i] = (1 - alpha) * next[i]! + alpha * r[i]!;
    }
    for (let i = 0; i < n; i++) out.set(nodeIds[i]!, s[i]!);
    return out;
  }

  /**
   * Handle omniweave_explore — deep exploration in a single call
   *
   * Strategy: find relevant symbols via graph traversal, group by file,
   * then read contiguous file sections covering all symbols per file.
   * This replaces multiple omniweave_node + Read calls.
   *
   * Output size is adaptive to project file count via
   * `getExploreOutputBudget` — see #185 for why a fixed 35k cap was a
   * tax on small projects while earning its keep on large ones.
   */
  private async handleExplore(
    args: Record<string, unknown>,
    outputSurface: OutputSurface = 'mcp',
  ): Promise<ToolResult> {
    const query = this.validateString(args.query, 'query');
    if (typeof query !== 'string') return query;

    const cg = this.getOmniWeave(args.projectPath as string | undefined);
    const projectRoot = cg.getProjectRoot();

    // Resolve adaptive output budget from project size. Falls back to the
    // largest-tier defaults if stats aren't available, which preserves
    // pre-#185 behavior for callers that hit the rare stats failure.
    let budget: ExploreOutputBudget;
    let fileCount: number | null = null;
    try {
      fileCount = cg.getStats().fileCount;
      budget = getExploreOutputBudget(fileCount);
    } catch {
      budget = getExploreOutputBudget(Infinity);
    }
    const maxFiles = parseExploreMaxFiles(args.maxFiles, budget.defaultMaxFiles);

    // Step 1: Find relevant context with generous parameters.
    // Use a large maxNodes budget — explore has its own 35k char output limit
    // that prevents context bloat, so more nodes just means better coverage
    // across entry points (especially for large files like Svelte components).
    const subgraph = await cg.findRelevantContext(query, {
      searchLimit: 8,
      traversalDepth: 3,
      maxNodes: 200,
      minScore: 0.2,
    });

    if (subgraph.nodes.size === 0) {
      return this.textResult(this.buildNoExploreResultsMessage(query, fileCount, outputSurface));
    }

    // Graph-aware glue: findRelevantContext builds the subgraph from name/text
    // search, so a method that BRIDGES named symbols — e.g. App.tsx's
    // triggerRender, which calls the named triggerUpdate — is never a search hit
    // and gets missed, forcing the agent to Read the file to trace it. Pull in
    // the callers/callees of the entry (root) nodes, but ONLY those that live in
    // files the subgraph already surfaces (where the agent reads to fill gaps),
    // so we add wiring without dragging in unrelated files. These get an
    // importance boost below so they survive the per-file cluster budget.
    const glueNodeIds = new Set<string>();
    const subgraphFiles = new Set<string>();
    for (const n of subgraph.nodes.values()) subgraphFiles.add(n.filePath);
    const GLUE_NODE_CAP = 60;
    for (const rootId of subgraph.roots) {
      if (glueNodeIds.size >= GLUE_NODE_CAP) break;
      let neighbors: Node[] = [];
      try {
        neighbors = [
          ...cg.getCallers(rootId).map(c => c.node),
          ...cg.getCallees(rootId).map(c => c.node),
        ];
      } catch {
        continue;
      }
      for (const nb of neighbors) {
        if (glueNodeIds.size >= GLUE_NODE_CAP) break;
        if (subgraph.nodes.has(nb.id)) continue;
        if (!subgraphFiles.has(nb.filePath)) continue;
        subgraph.nodes.set(nb.id, nb);
        glueNodeIds.add(nb.id);
      }
    }

    // Named-symbol seeding: findRelevantContext is an FTS/text rank, so a query
    // that's a BAG of symbol names skewed toward one phase (Alamofire: 5 build
    // terms, each a high-frequency name, vs 3 validate terms) lets the
    // lower-frequency names fall below the search cut — their definitions, and
    // whole files (Validation.swift), never get gathered, so they can never
    // render and the agent Reads them. Resolve EACH named token to its
    // substantive definition (skip empty stubs + test files, same relevance the
    // trace endpoint picker uses) and inject it as an entry, so every symbol the
    // agent explicitly named is in the subgraph and its file is scored.
    const namedSeedIds = new Set<string>();
    const ambiguousExploreTokens: AmbiguousExploreToken[] = [];
    {
      const CALLABLE = new Set(['method', 'function', 'component', 'constructor']);
      const isTestPath = (p: string) => /(^|\/)(tests?|specs?|__tests__|testdata|mocks?|fixtures?)\//i.test(p) || /\.(test|spec)\.[a-z]+$/i.test(p);
      const bodyLines = (n: Node) => Math.max(0, (n.endLine ?? n.startLine) - n.startLine);
      const tokens = extractExploreNameTokens(query, { includePrecedingPlainTokens: true });
      const allowLowSignalSeeds = queryAllowsLowSignalSources(query);
      // PascalCase tokens in the query are type/file disambiguators — when the
      // agent writes "DataRequest task validate", the `task`/`validate` it wants
      // are DataRequest's, NOT the same-named overloads in Validation.swift /
      // Concurrency.swift / the abstract base. Used below to bias overloaded
      // names toward the file/class the query also names. EXCLUDE the project
      // name (a PascalCase token a user naturally includes) — it names the whole
      // repo, so biasing toward it just pulls overloads to whichever stack
      // embeds it, re-burying the rest (#720).
      const projectNameTokens = cg.getProjectNameTokens();
      const typeTokens = tokens.filter(
        (o) => /^[A-Z][A-Za-z0-9]{3,}/.test(o) && !projectNameTokens.has(normalizeNameToken(o)),
      );
      const inNamedContext = (n: Node) =>
        typeTokens.some((ct) => {
          const lc = ct.toLowerCase();
          return n.filePath.toLowerCase().includes(lc) || n.qualifiedName.toLowerCase().includes(lc);
        });
      for (const t of tokens) {
        // Enumerate ALL defs of a bare token via the direct index, not FTS — a
        // 50+-overload name (tokio `poll`) ranks the wanted def (`Harness::poll`)
        // below the FTS cut, so findAllSymbols would never see it and the
        // type-token bias below couldn't pick the harness.rs one. (Same fix as
        // omniweave_node's findSymbolMatches.) Qualified tokens keep findAllSymbols.
        const isQual = /[.\/]|::/.test(t);
        const raw = isQual ? this.findAllSymbols(cg, t).nodes : cg.getNodesByName(t);
        const cands = raw
          .filter((n) => CALLABLE.has(n.kind) && !isTestPath(n.filePath) && (allowLowSignalSeeds || !isRepositorySnapshotFile(n.filePath)))
          .sort((a, b) => (bodyLines(b) > 1 ? 1 : 0) - (bodyLines(a) > 1 ? 1 : 0) || bodyLines(b) - bodyLines(a));
        // A specific name (<=3 defs) injects all its defs. An overloaded name
        // (`validate` = 10, `request` = 44) would flood the subgraph, so inject
        // only: the overloads whose file/class the query ALSO names (the agent
        // told us which one it wants — DataRequest's, not Validation.swift's),
        // capped; else fall back to the single most-substantive def. This is the
        // explore-side mirror of omniweave_node's overload disambiguation.
        let picks: Node[];
        if (cands.length <= 3) {
          picks = cands;
        } else {
          const ctx = cands.filter(inNamedContext);
          picks = ctx.length > 0 ? ctx.slice(0, 4) : cands.slice(0, 1);
          if (ctx.length === 0) {
            const picked = new Set(picks.map((n) => n.id));
            ambiguousExploreTokens.push({
              token: t,
              total: cands.length,
              selected: picks,
              alternatives: cands.filter((n) => !picked.has(n.id)).slice(0, 4),
            });
          }
        }
        for (const n of picks) {
          if (!subgraph.nodes.has(n.id)) subgraph.nodes.set(n.id, n);
          // Mark as a named seed EVEN IF the FTS gather already had it — being
          // "named by the agent" is independent of whether search happened to
          // surface it, and it drives the +50 score, the gate, and the
          // named-file sort below. (Previously only NEW injections were marked,
          // so a named symbol FTS already gathered never sorted to the top.)
          namedSeedIds.add(n.id);
        }
      }
    }

    // Step 2: Group nodes by file, score by relevance
    const fileGroups = new Map<string, { nodes: Node[]; score: number }>();
    const entryNodeIds = new Set([...subgraph.roots, ...namedSeedIds]);

    // Build a set of nodes directly connected to entry points (depth 1)
    const connectedToEntry = new Set<string>();
    for (const edge of subgraph.edges) {
      if (entryNodeIds.has(edge.source)) connectedToEntry.add(edge.target);
      if (entryNodeIds.has(edge.target)) connectedToEntry.add(edge.source);
    }

    for (const node of subgraph.nodes.values()) {
      // Skip import/export nodes — they add noise without information
      if (node.kind === 'import' || node.kind === 'export') continue;
      // SECURITY (#383): never render the on-disk source of a config-leaf
      // (Spring application.{yml,properties} key) — its line is `key = <secret>`,
      // so whole-file/cluster rendering here would push secrets into context
      // unbidden. The key still appears in the flow/symbol listing above.
      if (isConfigLeafNode(node)) continue;

      const group = fileGroups.get(node.filePath) || { nodes: [], score: 0 };
      group.nodes.push(node);
      // Score: a NAMED-SEED node (a symbol the agent named that FTS missed, now
      // injected) is worth far more than a mere reference — its file is where the
      // answer lives. Without this, an incidental file that name-drops the flow
      // (Combine.swift references request/task → score 23 from connected nodes)
      // outranks the file that DEFINES a named symbol (Validation.swift's
      // `validate` → 10) and steals its render slot. Definition ≫ reference.
      if (namedSeedIds.has(node.id)) {
        group.score += 50;
      } else if (entryNodeIds.has(node.id)) {
        group.score += 10;
      } else if (connectedToEntry.has(node.id)) {
        group.score += 3;
      } else {
        group.score += 1;
      }
      fileGroups.set(node.filePath, group);
    }

    // Only include files that have entry points or nodes directly connected to entry points
    let relevantFiles = [...fileGroups.entries()].filter(([, group]) => group.score >= 3);

    // Extract query terms for relevance checking
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 3);

    // Test/spec/snapshot/icon/i18n file detector — used both for the pre-sort hard
    // filter (tiny tier) and the comparator deprioritization (all tiers).
    const isLowValue = (p: string) => {
      const lp = p.toLowerCase();
      return (
        isLowSignalSourceFile(p) ||
        /\bicons?\b/.test(lp) ||
        /\bi18n\b/.test(lp)
      );
    };

    // Hard-exclude test/spec/research-snapshot files (ALL tiers, not just tiny). One slipped test
    // file dominates the per-file budget on small repos (cobra's `command_test.go`
    // displaced `args.go`) AND wastes budget on large ones (Django's
    // `custom_lookups/tests.py` ate ~2.3 KB of the 28 KB cap, crowding out the
    // SQLCompiler mechanism the agent then Read). A test file almost never answers
    // an architecture question. Skip when the query itself is about tests — the
    // legitimate "explore the tests" case — and only cut if ≥2 non-test candidates
    // remain (else tests are the only signal for this area).
    {
      const queryMentionsLowSignalPath = queryAllowsLowSignalSources(query);
      if (!isRepositorySnapshotQuery(query)) {
        relevantFiles = relevantFiles.filter(([p]) => !isRepositorySnapshotFile(p));
      }
      if (!queryMentionsLowSignalPath) {
        const nonLow = relevantFiles.filter(([p]) => !isLowValue(p));
        if (nonLow.length >= 2) {
          relevantFiles = nonLow;
        }
      }
    }
    if (relevantFiles.length === 0) {
      return this.textResult(this.buildNoExploreResultsMessage(query, fileCount, outputSurface));
    }

    // Secondary signal: how many DISTINCT query terms each file matches (path +
    // symbol names). Kept only as a tiebreak — the PRIMARY relevance is graph
    // connectivity below. (Term counting alone tied the real central file with
    // incidental same-word matches; it's a weak text signal, not the ranker.)
    const uniqueQueryTerms = [...new Set(queryTerms)].filter(t => t.length >= 3);
    const fileTermHits = new Map<string, number>();
    for (const [fp, group] of relevantFiles) {
      const hay = fp.toLowerCase() + ' ' + group.nodes.map(n => n.name.toLowerCase()).join(' ');
      let hits = 0;
      for (const t of uniqueQueryTerms) if (hay.includes(t)) hits++;
      fileTermHits.set(fp, hits);
    }

    // PRIMARY relevance: graph connectivity (Random-Walk-with-Restart from the
    // matched seeds — see computeGraphRelevance). Aggregate each file's nodes'
    // walk mass. This is the signal text search lacks: the real cluster
    // (org-user.storage.ts, call-connected to the matches) accrues mass; a lone
    // text match (LensSwitcher.swift, matched "switch" but calls nothing in the
    // flow) gets only its restart probability → ~0, and is dropped by the gate.
    const nodeRwr = this.computeGraphRelevance(
      [...subgraph.nodes.keys()], subgraph.edges, entryNodeIds,
    );
    const fileGraphScore = new Map<string, number>();
    for (const node of subgraph.nodes.values()) {
      fileGraphScore.set(
        node.filePath,
        (fileGraphScore.get(node.filePath) ?? 0) + (nodeRwr.get(node.id) ?? 0),
      );
    }
    const maxGraph = Math.max(0, ...fileGraphScore.values());

    // Central file(s): the 1-2 most graph-central files that also match the
    // query textually (so a connected hub-utility with no term match isn't
    // mistaken for the subject). The heart of the answer — they earn the larger
    // WHOLE-FILE ceiling below (a god-file central file still exceeds it and
    // falls to generous full-method sectioning — never a whole dump).
    const centralFiles = new Set(
      [...fileGraphScore.entries()]
        .filter(([fp, g]) => g > 0 && (fileTermHits.get(fp) ?? 0) >= 1)
        .sort((a, b) => b[1] - a[1] || (fileTermHits.get(b[0]) ?? 0) - (fileTermHits.get(a[0]) ?? 0))
        .slice(0, 2)
        .map(([f]) => f),
    );

    // Files that DEFINE a symbol the agent named (or a subgraph root). These are
    // the highest-relevance files there are — the agent asked for them by name —
    // so the connectivity gate below must never drop them, even when their RWR
    // mass is low (a leaf family file like codec.ts is call-connected to little
    // but is exactly what the agent queried). Without this protection the gate
    // prunes a named file and the agent Reads it back.
    const entryFiles = new Set<string>();
    for (const id of entryNodeIds) {
      const n = subgraph.nodes.get(id);
      if (n) entryFiles.add(n.filePath);
    }

    // Relevance gate (so the generous budget is a CEILING, not a target): keep a
    // file only if it is STRUCTURALLY relevant by ANY of:
    //   - graph score within a fraction of the top (it's on/near the flow), OR
    //   - central (a query entry-point lives here), OR
    //   - it DEFINES a symbol the agent named (entryFiles), OR
    //   - it matches >= 2 DISTINCT named query terms — a strong text signal that
    //     the agent is asking about this file even when nothing calls it (codec.ts:
    //     the agent named `encode`/`Codec`/`JsonCodec`, all leaf classes with zero
    //     RWR mass — graph alone wrongly drops it).
    // A lone text match on one shared word (LensSwitcher: term=1, g~0) is still
    // dropped, so the budget never fills with incidental files. Guarded so it
    // never prunes below 2.
    if (maxGraph > 0) {
      const gated = relevantFiles.filter(([fp]) =>
        (fileGraphScore.get(fp) ?? 0) >= maxGraph * 0.06
        || centralFiles.has(fp)
        || entryFiles.has(fp)
        || (fileTermHits.get(fp) ?? 0) >= 2,
      );
      if (gated.length >= 2) relevantFiles = gated;
    }

    // Sort files: graph-central first, then distinct-term match, then the
    // existing low-value/generated/score tiebreaks.
    // Files that DEFINE a symbol the agent NAMED. These sort first — ahead of
    // graph connectivity — because the agent asked for them by name. Without
    // this, a named leaf override reached only by dynamic dispatch (Alamofire's
    // `DataRequest.task`/`validate`, low RWR mass) sorts below the high-
    // connectivity abstract base (`Request.swift`) and the same-named overloads
    // in other files (`Validation.swift`), falls outside the budget, and the
    // agent Reads it. The named file is the answer — rank it at the top.
    const namedSeedFiles = new Set<string>();
    for (const id of namedSeedIds) {
      const n = subgraph.nodes.get(id);
      if (n) namedSeedFiles.add(n.filePath);
    }
    const actionableKinds = new Set<NodeKind>(['class', 'struct', 'function', 'method', 'component', 'route']);
    const hasActionableSource = (group: { nodes: Node[]; score: number }): boolean =>
      group.nodes.some((n) => actionableKinds.has(n.kind));

    const sortedFiles = relevantFiles.sort((a, b) => {
      const aPath = a[0].toLowerCase();
      const bPath = b[0].toLowerCase();

      // Agent-named files first (it asked for a symbol defined here by name).
      const aNamed = namedSeedFiles.has(a[0]) ? 1 : 0;
      const bNamed = namedSeedFiles.has(b[0]) ? 1 : 0;
      if (aNamed !== bNamed) return bNamed - aNamed;

      if (namedSeedFiles.size > 0) {
        const aActionable = hasActionableSource(a[1]) ? 1 : 0;
        const bActionable = hasActionableSource(b[1]) ? 1 : 0;
        if (aActionable !== bActionable) return bActionable - aActionable;
      }

      // Graph connectivity is the next key (small epsilon so near-ties fall
      // through to the text signal rather than coin-flipping on float noise).
      const aG = fileGraphScore.get(a[0]) ?? 0;
      const bG = fileGraphScore.get(b[0]) ?? 0;
      if (Math.abs(aG - bG) > maxGraph * 0.01) return bG - aG;

      const aHits = fileTermHits.get(a[0]) ?? 0;
      const bHits = fileTermHits.get(b[0]) ?? 0;
      if (aHits !== bHits) return bHits - aHits;

      const aLow = isLowValue(aPath);
      const bLow = isLowValue(bPath);
      if (aLow !== bLow) return aLow ? 1 : -1;

      // Deprioritize generated source (.pb.go / .pulsar.go / _mocks.go / …) —
      // the agent rarely needs to see the protobuf scaffold or gomock output
      // when asking about the actual flow, and dumping their bodies inflates
      // the response (the cosmos Q3 explore otherwise leads with
      // `expected_keepers_mocks.go`, displacing the real `tally.go` content
      // and forcing the agent to Read tally.go anyway).
      const aGen = isGeneratedFile(a[0]);
      const bGen = isGeneratedFile(b[0]);
      if (aGen !== bGen) return aGen ? 1 : -1;

      if (a[1].score !== b[1].score) return b[1].score - a[1].score;
      return b[1].nodes.length - a[1].nodes.length;
    });

    // Step 3: Build relationship map
    const lines: string[] = [
      `## Exploration: ${query}`,
      '',
    ];
    const coverageLineIndex = lines.length;
    lines.push('', '');

    const ambiguity = this.buildAmbiguousExploreSection(ambiguousExploreTokens, outputSurface);
    if (ambiguity) lines.push(ambiguity);

    // Blast radius (always-on, compact): for the entry symbols, who depends on
    // them + which tests cover them — locations only, no source — so the agent
    // knows what to update/verify before editing without a separate call.
    const blastRadius = this.buildBlastRadiusSection(cg, subgraph);
    if (blastRadius) lines.push(blastRadius);

    // Relationship map — supporting graph facts, not necessarily the main call path.
    const allowLowSignalRelationships = queryAllowsLowSignalSources(query);
    const significantEdges = subgraph.edges.filter(e =>
      e.kind !== 'contains' // skip contains — it's implied by file grouping
    ).filter((edge) => {
      if (allowLowSignalRelationships) return true;
      const sourceNode = subgraph.nodes.get(edge.source);
      const targetNode = subgraph.nodes.get(edge.target);
      if (!sourceNode || !targetNode) return false;
      return !isLowSignalSourceFile(sourceNode.filePath) && !isLowSignalSourceFile(targetNode.filePath);
    }).sort((a, b) => {
      const rank = (EXPLORE_RELATIONSHIP_KIND_RANK[a.kind] ?? 50) - (EXPLORE_RELATIONSHIP_KIND_RANK[b.kind] ?? 50);
      if (rank !== 0) return rank;
      const aHeuristic = a.provenance === 'heuristic' ? 1 : 0;
      const bHeuristic = b.provenance === 'heuristic' ? 1 : 0;
      if (aHeuristic !== bHeuristic) return bHeuristic - aHeuristic;
      const aLine = a.line ?? Number.MAX_SAFE_INTEGER;
      const bLine = b.line ?? Number.MAX_SAFE_INTEGER;
      return aLine - bLine;
    });

    const relationshipLines: string[] = [];
    if (budget.includeRelationships && significantEdges.length > 0) {
      relationshipLines.push('### Supporting relationships (not necessarily the call path)');
      relationshipLines.push('');

      // Group edges by kind for readability
      const byKind = new Map<EdgeKind, Array<{ edge: Edge; source: Node; target: Node }>>();
      for (const edge of significantEdges) {
        const sourceNode = subgraph.nodes.get(edge.source);
        const targetNode = subgraph.nodes.get(edge.target);
        if (!sourceNode || !targetNode) continue;

        const group = byKind.get(edge.kind) || [];
        group.push({ edge, source: sourceNode, target: targetNode });
        byKind.set(edge.kind, group);
      }

      for (const [kind, edges] of byKind) {
        const cap = budget.maxEdgesPerRelationshipKind;
        const shown = edges.slice(0, cap);
        relationshipLines.push(`**${kind}:**`);
        for (const e of shown) {
          relationshipLines.push(this.formatExploreRelationshipEdge(e.edge, e.source, e.target));
        }
        if (edges.length > cap) {
          relationshipLines.push(`- ... and ${edges.length - cap} more`);
        }
        relationshipLines.push('');
      }
    }

    // Step 4: Read contiguous file sections
    // Compute the flow spine once — used both to prepend the Flow section (below)
    // and to gate adaptive source sizing: files on the spine get full source,
    // off-spine peers skeletonize.
    const flow = this.buildFlowFromNamedSymbols(cg, query, outputSurface);

    // Polymorphic-sibling detector for adaptive sizing. A class that implements/
    // extends a supertype shared by >= MIN_SIBLINGS classes is one of many
    // INTERCHANGEABLE implementations (OkHttp's 14 `: Interceptor` classes —
    // showing one + the rest as signatures is enough), as opposed to a DISTINCT
    // pipeline step (Excalidraw's `renderStaticScene`, which shares no supertype and
    // must stay full or the agent loses real content). Only off-spine sibling files
    // skeletonize; distinct steps and on-spine files keep full source. Cache
    // supertype→(has ≥N implementers) so this stays a handful of edge queries.
    const MIN_SIBLINGS = 3;
    const siblingSuper = new Map<string, boolean>();
    const isPolymorphicSibling = (nodes: Node[]): boolean => {
      for (const n of nodes) {
        for (const e of cg.getOutgoingEdges(n.id)) {
          if (e.kind !== 'implements' && e.kind !== 'extends') continue;
          let many = siblingSuper.get(e.target);
          if (many === undefined) {
            many = cg.getIncomingEdges(e.target)
              .filter((x) => x.kind === 'implements' || x.kind === 'extends').length >= MIN_SIBLINGS;
            siblingSuper.set(e.target, many);
          }
          if (many) return true;
        }
      }
      return false;
    };

    // A file that DEFINES a polymorphic supertype (a class/interface with ≥
    // MIN_SIBLINGS implementers) AND co-locates its subclasses is a redundant
    // "family" file — Django's compiler.py holds `SQLCompiler` + its 4 subclasses
    // (SQLInsert/Update/Delete/AggregateCompiler) in 2,266 lines. Such files are
    // huge and read-anyway, so they should STILL skeletonize even when the agent
    // named a method in them: a full one eats ~6.5K of the explore budget (Django
    // is pinned at the 28K cap, truncating), starving the sibling files the agent
    // then Reads. This flag OVERRIDES the named-callable spare below — it does NOT
    // by itself spare a file. (OkHttp's RealCall implements the `Lockable` mixin
    // but defines no ≥3-impl supertype, so the named spare keeps it full.)
    const superMany = new Map<string, boolean>();
    const definesPolymorphicSupertype = (nodes: Node[]): boolean => {
      for (const n of nodes) {
        if (n.kind !== 'class' && n.kind !== 'interface' && n.kind !== 'struct'
            && n.kind !== 'trait' && n.kind !== 'protocol' && n.kind !== 'type_alias') continue;
        let many = superMany.get(n.id);
        if (many === undefined) {
          many = cg.getIncomingEdges(n.id)
            .filter((x) => x.kind === 'implements' || x.kind === 'extends').length >= MIN_SIBLINGS;
          superMany.set(n.id, many);
        }
        if (many) return true;
      }
      return false;
    };

    lines.push('### Source Code');
    lines.push('');
    lines.push('> The code blocks below are **verbatim, current on-disk source ranges** — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns for those ranges. They are NOT summaries, outlines, or stale cache. Treat each complete block shown here as a Read you have already performed.');
    lines.push('');

    let totalChars = lines.join('\n').length;
    let filesIncluded = 0;
    let anyFileTrimmed = false;
    let anyPartialSourceView = false;
    const shownSourceFiles = new Set<string>();

    for (const [filePath, group] of sortedFiles) {
      if (filesIncluded >= maxFiles) break;
      // A file DEFINES a named/spine symbol (the answer) vs merely references the
      // flow. Past 90% budget, stop pulling INCIDENTAL files — but keep scanning
      // for necessary ones, which render even past the cap (bounded by maxFiles).
      // Without this `continue` (was an unconditional `break`), the loop stopped
      // after the build + validators-exec files and never reached the ranked-in
      // validate-logic file (Alamofire's Validation.swift).
      const fileNecessary = group.nodes.some(n =>
        entryNodeIds.has(n.id) || flow.pathNodeIds.has(n.id) || flow.uniqueNamedNodeIds.has(n.id));
      if (!fileNecessary && totalChars > budget.maxOutputChars * 0.9) continue;

      const absPath = validatePathWithinRoot(projectRoot, filePath);
      if (!absPath) continue;
      if (!existsSync(absPath)) {
        const names = [...new Set(group.nodes.filter(n => n.kind !== 'import' && n.kind !== 'export').map(n => `${n.name}(${n.kind})`))]
          .slice(0, budget.maxSymbolsInFileHeader)
          .join(', ');
        const missingSection = [
          `#### ${filePath} — ${names || 'indexed symbols'} · indexed but missing on disk`,
          '',
          '> This path was present when the index was built, but it is not present on disk now. Treat these symbol and relationship hits as stale until `omniweave sync` or a reindex reconciles the project.',
          '',
        ];
        lines.push(...missingSection);
        totalChars += missingSection.join('\n').length + 80;
        filesIncluded++;
        shownSourceFiles.add(filePath);
        anyFileTrimmed = true;
        continue;
      }

      let fileContent: string;
      try {
        fileContent = readFileSync(absPath, 'utf-8');
      } catch {
        continue;
      }

      const fileLines = fileContent.split('\n');
      const lang = group.nodes[0]?.language || '';

      // Adaptive sizing (OMNIWEAVE_ADAPTIVE_EXPLORE, default on): collapse a file
      // to a per-symbol view when it's a redundant member of a polymorphic family.
      // Engages iff ALL hold:
      //   1. a flow spine exists,
      //   2. no symbol in the file is on that spine (it's not the mechanism path),
      //   3. it IS a polymorphic sibling (≥ MIN_SIBLINGS impls of a shared supertype),
      //   4. it is NOT SPARED, where a file is spared iff the agent named a
      //      (near-)UNIQUE callable in it (`getResponseWithInterceptorChain`, 1 def →
      //      keep RealCall.kt full) UNLESS the file DEFINES the family supertype (a
      //      base+subclasses "family" file like Django's compiler.py — collapse it).
      //      Uniqueness matters: `as_sql` has 110 defs across every Compiler/Expression
      //      subclass; naming it must NOT keep every backend variant + test file full
      //      and flood the budget. That's why the spare reads uniqueNamedNodeIds.
      // Within a collapsed file the render is PER-SYMBOL (condition B): a method the
      // agent NAMED or that's on the spine is shown with its FULL body (so the agent
      // doesn't Read the file back for it — Django's SQLCompiler.execute_sql/as_sql);
      // every other symbol is just its signature. So the base mechanism survives while
      // the file's other ~80 symbols + the redundant subclasses collapse to one line each.
      const spareNamed = group.nodes.some(n => flow.uniqueNamedNodeIds.has(n.id));
      const fileDefinesSuper = definesPolymorphicSupertype(group.nodes);
      const spared = spareNamed && !fileDefinesSuper;
      const CALLABLE_BODY = new Set(['method', 'function', 'constructor', 'component']);
      const hasSpineNode = group.nodes.some(n => flow.pathNodeIds.has(n.id));
      // On-spine god-file: the flow path runs THROUGH this file, but it also holds
      // many OTHER named methods, and rendering all of them in full blows the
      // per-file budget and starves the other flow files (Alamofire: the agent
      // names ~7 Session.swift methods — the build spine PLUS off-path
      // task/didCompleteTask — far past the whole response budget). Engage the
      // per-symbol view to keep the SPINE full and collapse the off-path named
      // methods to signatures. Only when there IS off-path content to shed —
      // otherwise the spine is irreducible (a sequential flow has no redundancy),
      // so leave it to the normal full render.
      const namedBodyChars = group.nodes
        .filter(n => CALLABLE_BODY.has(n.kind) && (flow.pathNodeIds.has(n.id) || flow.uniqueNamedNodeIds.has(n.id)))
        .reduce((s, n) => s + fileLines.slice(n.startLine - 1, n.endLine).join('\n').length, 0);
      const onSpineGodFile = hasSpineNode
        && namedBodyChars > budget.maxCharsPerFile
        && group.nodes.some(n => CALLABLE_BODY.has(n.kind) && flow.uniqueNamedNodeIds.has(n.id) && !flow.pathNodeIds.has(n.id));
      if (adaptiveExploreEnabled() && flow.pathNodeIds.size > 0
          && (onSpineGodFile || (!hasSpineNode && isPolymorphicSibling(group.nodes) && !spared))) {
        const syms = group.nodes
          .filter(n => n.kind !== 'import' && n.kind !== 'export' && n.startLine > 0)
          .sort((a, b) => a.startLine - b.startLine);
        // Pass 1: choose which symbols get a FULL body, by priority, greedily within
        // a per-file body cap — so one huge family file can't body every named method
        // and crowd out the other flow files (Django's query.py). A symbol earns a
        // body if it's on-spine, or UNIQUELY named (`SQLCompiler.execute_sql`), or a
        // co-named method WHEN this file DEFINES the family supertype (so the base
        // `SQLCompiler.as_sql` body shows, but the 110 leaf `as_sql` overrides — and
        // OkHttp's 5 `intercept`s if the agent names `intercept` — stay signatures).
        const prio = (n: Node) => !CALLABLE_BODY.has(n.kind) ? 99
          : flow.pathNodeIds.has(n.id) ? 0
          : flow.uniqueNamedNodeIds.has(n.id) ? 1
          : (fileDefinesSuper && flow.namedNodeIds.has(n.id)) ? 2 : 99;
        // One ~250-line WINDOW per file. syms are taken by priority (spine first,
        // then uniquely-named, then family-base), and the cap applies to ALL of
        // them — including the spine — so a big-spine god-file (tokio's worker.rs:
        // run→run_task→next_task→steal_work) can't eat the whole response and
        // starve the co-flow file (harness.rs's poll). The native agent windows
        // such a file too (~190 lines at a time), so this mimics, not truncates.
        // Always emit ≥1 (never an empty section).
        const bodyCap = budget.maxCharsPerFile * 1.5;
        const bodyIds = new Set<string>();
        let bodyChars = 0;
        for (const n of syms.filter(n => prio(n) < 99 && n.endLine >= n.startLine).sort((a, b) => prio(a) - prio(b))) {
          const sz = fileLines.slice(n.startLine - 1, n.endLine).join('\n').length;
          if (bodyChars + sz > bodyCap && bodyIds.size > 0) continue;
          bodyIds.add(n.id);
          bodyChars += sz;
        }
        // Pass 2: render in line order — full body for chosen symbols, else the
        // signature line (capped, with a "+N more" tail so the structure map of a
        // god-file doesn't itself bloat the budget).
        const skel: string[] = [];
        let coveredUntil = 0; // skip symbols already inside an emitted body
        let sigCount = 0, sigDropped = 0;
        const SIG_MAX = Math.max(12, budget.maxSymbolsInFileHeader * 2);
        for (const n of syms) {
          if (n.startLine <= coveredUntil) continue;
          if (bodyIds.has(n.id)) {
            const end = n.endLine;
            const body = fileLines.slice(n.startLine - 1, end).join('\n');
            skel.push(exploreLineNumbersEnabled() ? numberSourceLines(body, n.startLine) : body);
            coveredUntil = end;
          } else {
            // Elide the body, emit the signature. node.startLine can point at a
            // decorator/annotation, so scan forward for the line that names the symbol.
            let lineNo = n.startLine;
            for (let k = 0; k < 4; k++) {
              if ((fileLines[n.startLine - 1 + k] || '').includes(n.name)) { lineNo = n.startLine + k; break; }
            }
            if (lineNo <= coveredUntil) continue;
            if (sigCount >= SIG_MAX) { sigDropped++; continue; }
            const sig = (fileLines[lineNo - 1] || '').trim();
            if (sig) { skel.push(exploreLineNumbersEnabled() ? `${lineNo}\t${sig}` : sig); sigCount++; }
          }
        }
        if (sigDropped > 0) skel.push(`… +${sigDropped} more (signatures elided)`);
        if (skel.length > 0) {
          const names = [...new Set(group.nodes.filter(n => n.kind !== 'import' && n.kind !== 'export').map(n => n.name))]
            .slice(0, budget.maxSymbolsInFileHeader).join(', ');
          // Steer the agent to omniweave_explore for an elided body — NEVER to
          // Read. The old "Read for more" / "Read for a full body" tags invited
          // a Read of the very file just skeletonized; on a central, wanted file
          // (Session.swift, DataRequest.swift) that fired an over-investigation
          // spiral (the agent Read the skeletonized file, then kept digging).
          // CLAUDE.md: explore output must never tell the agent to Read.
          const followUp = outputSurface === 'cli'
            ? 'omniweave explore "<signature name>"'
            : 'omniweave_explore a signature by name';
          const tag = bodyIds.size > 0
            ? `focused (the methods you named in full, the rest as signatures — ${followUp} for its body; do NOT Read)`
            : `skeleton (signatures only — ${followUp} for a full body; do NOT Read)`;
          lines.push(`#### ${filePath} — ${names} · ${tag}`, '', '```' + lang, skel.join('\n'), '```', '');
          anyPartialSourceView = true;
          totalChars += skel.join('\n').length + 120;
          filesIncluded++;
          shownSourceFiles.add(filePath);
          continue;
        }
      }

      // Whole-file rule: if a relevant file is small enough to afford, return it
      // ENTIRELY instead of clustering. Clustering exists to tame god-files
      // (App.tsx ~13k lines); on a ~134-line component a cluster is a lossy
      // subset of a file the agent will just Read in full anyway — costing a
      // round-trip and a re-read every later turn. Reserve clustering for files
      // too big to ship whole. Still bounded by the total maxOutputChars check.
      //
      // CENTRAL files (where the query's entry points live) get a larger — but
      // bounded — ceiling: they're the heart of the answer, the file(s) the agent
      // would Read whole, so a genuinely small one comes back whole rather than as
      // thin clusters. A LARGE central file (the 791-line org-user store) exceeds
      // the ceiling and falls through to sectioning/clustering below — full method
      // bodies + signatures — so we never dump (or overflow on) a whole god-file.
      const isCentralFile = centralFiles.has(filePath);
      // Central files get a slightly larger whole-file window than peripheral ones,
      // but a TIGHT one (~1.5× the per-file cap): the native read of a central file
      // is a ~150–250 line orientation window, NOT the whole file. A flat "whole
      // central file" both overflowed the inline cap AND starved the co-flow files
      // (worker.rs ate the budget, dropping harness.rs's poll). A larger central
      // file falls through to per-method windowing/clustering below.
      const WHOLE_FILE_MAX_LINES = isCentralFile ? 280 : 220;
      const WHOLE_FILE_MAX_CHARS = isCentralFile
        ? Math.min(Math.max(0, budget.maxOutputChars - totalChars - 200), Math.round(budget.maxCharsPerFile * 1.5))
        : budget.maxCharsPerFile * 3;
      if (fileLines.length <= WHOLE_FILE_MAX_LINES && fileContent.length <= WHOLE_FILE_MAX_CHARS) {
        const body = fileContent.replace(/\n+$/, '');
        let wholeSection = exploreLineNumbersEnabled() ? numberSourceLines(body, 1) : body;
        const uniqSymbols = [...new Set(
          group.nodes
            .filter(n => n.kind !== 'import' && n.kind !== 'export')
            .map(n => `${n.name}(${n.kind})`)
        )];
        const headerNames = uniqSymbols.slice(0, budget.maxSymbolsInFileHeader);
        const omitted = uniqSymbols.length - headerNames.length;
        const wholeHeader = `#### ${filePath} — ${omitted > 0 ? `${headerNames.join(', ')}, +${omitted} more` : headerNames.join(', ')}`;

        if (!fileNecessary && totalChars + wholeSection.length + 200 > budget.maxOutputChars) {
          // Don't slice a whole file mid-method: an incidental file that doesn't
          // fit is skipped; a necessary one (below) renders in full. Half a file
          // forces the Read this is meant to prevent.
          anyFileTrimmed = true;
          continue;
        }
        lines.push(wholeHeader, '', '```' + lang, wholeSection, '```', '');
        totalChars += wholeSection.length + 200;
        filesIncluded++;
        shownSourceFiles.add(filePath);
        continue;
      }

      // Cluster nearby symbols to avoid reading huge gaps between distant symbols.
      // Sort by start line, then merge overlapping/adjacent ranges (within the
      // adaptive gap threshold). Include both node ranges AND edge source
      // locations so template sections with component usages/calls are
      // covered (not just script block symbols).
      //
      // Each range carries an `importance` score so we can rank clusters
      // when the per-file budget forces us to drop some: entry-point nodes
      // are worth 10, directly-connected nodes 3, peripheral nodes 1, and
      // bare edge-source lines 2 (less than a connected node but more than
      // a peripheral one — they hint at a reference but aren't a definition).
      // Container kinds whose body can span most/all of a file. When such a
      // node covers most of the file we drop it from the ranges: keeping it
      // would merge every method inside it into one giant cluster spanning
      // the whole file, which then tail-trims down to just the container's
      // opening lines (its header/declarations) and buries the methods the
      // query actually asked about (#185 follow-up — Session.swift in
      // Alamofire is the canonical case: the `Session` class spans ~1,400
      // lines). We want the granular symbols inside, not the envelope.
      const ENVELOPE_KINDS = new Set(['file', 'module', 'class', 'struct', 'interface', 'enum', 'namespace', 'protocol', 'trait', 'component']);
      // Cluster from this file's gathered nodes PLUS any callable the agent NAMED that
      // lives here. Explore's relevance gather can miss a named method def in a huge
      // non-sibling file — Django's query.py is 3,040 lines and `_fetch_all` (L2237)
      // was gathered only as call-reference edges, never as a def, so it formed no
      // cluster and the agent Read it back. Inject named defs directly and rank them
      // ABOVE connected/glue nodes (importance 9) so their cluster wins the per-file
      // budget — the agent explicitly asked for these symbols.
      const rangeNodes = new Map<string, Node>();
      for (const n of group.nodes) if (n.startLine > 0 && n.endLine > 0) rangeNodes.set(n.id, n);
      for (const id of flow.namedNodeIds) {
        if (rangeNodes.has(id)) continue;
        const n = cg.getNode(id);
        if (n && n.filePath === filePath && n.startLine > 0 && n.endLine > 0) rangeNodes.set(id, n);
      }
      const ranges: Array<{ start: number; end: number; name: string; kind: string; importance: number }> = [...rangeNodes.values()]
        // Drop whole-file envelope nodes (containers covering >50% of the file).
        .filter(n => !(ENVELOPE_KINDS.has(n.kind) && (n.endLine - n.startLine + 1) > fileLines.length * 0.5))
        .map(n => {
          let importance = 1;
          if (entryNodeIds.has(n.id)) importance = 10;
          else if (flow.namedNodeIds.has(n.id)) importance = 9; // agent named it → keep its cluster
          else if (glueNodeIds.has(n.id)) importance = 6; // bridging caller/callee of an entry
          else if (connectedToEntry.has(n.id)) importance = 3;
          return { start: n.startLine, end: n.endLine, name: n.name, kind: n.kind, importance };
        });

      // Add edge source locations in this file — captures template references
      // (component usages, event handlers) that aren't nodes themselves.
      // Query edges directly from the DB (not just the subgraph) because BFS
      // traversal may have pruned template reference targets due to node budget.
      const edgeLines = new Set<string>(); // dedup by "line:name"
      for (const node of group.nodes) {
        const outgoing = cg.getOutgoingEdges(node.id);
        for (const edge of outgoing) {
          if (!edge.line || edge.line <= 0 || edge.kind === 'contains') continue;
          const key = `${edge.line}:${edge.target}`;
          if (edgeLines.has(key)) continue;
          edgeLines.add(key);
          // Look up target name from subgraph first, fall back to edge kind
          const targetNode = subgraph.nodes.get(edge.target);
          const targetName = targetNode?.name ?? edge.kind;
          ranges.push({ start: edge.line, end: edge.line, name: targetName, kind: edge.kind, importance: 2 });
        }
      }

      ranges.sort((a, b) => a.start - b.start);

      if (ranges.length === 0) continue;

      const gapThreshold = budget.gapThreshold;
      const clusters: Array<{ start: number; end: number; symbols: string[]; score: number; maxImportance: number }> = [];
      let current = {
        start: ranges[0]!.start,
        end: ranges[0]!.end,
        symbols: [`${ranges[0]!.name}(${ranges[0]!.kind})`],
        score: ranges[0]!.importance,
        maxImportance: ranges[0]!.importance,
      };

      for (let i = 1; i < ranges.length; i++) {
        const r = ranges[i]!;
        if (r.start <= current.end + gapThreshold) {
          current.end = Math.max(current.end, r.end);
          current.symbols.push(`${r.name}(${r.kind})`);
          current.score += r.importance;
          current.maxImportance = Math.max(current.maxImportance, r.importance);
        } else {
          clusters.push(current);
          current = {
            start: r.start,
            end: r.end,
            symbols: [`${r.name}(${r.kind})`],
            score: r.importance,
            maxImportance: r.importance,
          };
        }
      }
      clusters.push(current);

      // Build file section output from clusters, capped by per-file budget.
      // The pathological case (#185): a file like Session.swift where every
      // method is adjacent collapses into one cluster spanning the whole
      // file, and dumping that into the agent's context is most of the
      // token cost on small projects. We pick clusters in priority order
      // until the per-file char cap is hit. Truly enormous single clusters
      // get tail-trimmed with a marker.
      const contextPadding = 3;
      const withLineNumbers = exploreLineNumbersEnabled();
      const buildSection = (c: { start: number; end: number }): string => {
        const startIdx = Math.max(0, c.start - 1 - contextPadding);
        const endIdx = Math.min(fileLines.length, c.end + contextPadding);
        const slice = fileLines.slice(startIdx, endIdx).join('\n');
        // startIdx is 0-based, so the slice's first line is line startIdx + 1.
        return withLineNumbers ? numberSourceLines(slice, startIdx + 1) : slice;
      };
      // Language-neutral separator (no `//` — not a comment in Python, Ruby,
      // etc.). With line numbers on, the line-number jump also signals the gap.
      const GAP_MARKER = '\n\n... (gap) ...\n\n';
      const truncateOversizedSourceRange = (section: string, maxChars: number): { text: string; truncated: boolean } => {
        const retry = outputSurface === 'cli'
          ? 'rerun `omniweave explore "<symbol-or-file>"` with a narrower symbol/file query'
          : 'rerun omniweave_explore with a narrower symbol/file query';
        const marker = `\n\n... (oversized source range omitted; ${retry} for the next window) ...`;
        if (section.length <= maxChars) return { text: section, truncated: false };
        const limit = Math.max(0, maxChars - marker.length);
        if (limit <= 0) return { text: marker.trimStart(), truncated: true };
        const cut = section.slice(0, limit);
        const lastLineBreak = cut.lastIndexOf('\n');
        const safeCut = lastLineBreak > 0 ? cut.slice(0, lastLineBreak) : cut;
        return { text: safeCut.trimEnd() + marker, truncated: true };
      };

      // Rank clusters for inclusion under the per-file cap. Entry-point
      // clusters come first: a cluster containing a query entry point
      // (importance 10) must outrank a dense block of mere declarations,
      // otherwise on a large file like Session.swift the top-of-file class
      // header + property list (many adjacent low-importance nodes, high
      // density) wins the budget and buries the actual methods the query
      // asked about (perform/didCreateURLRequest/task live deep in the
      // file). Within the same importance tier, prefer density (score per
      // line) so we still favor focused clusters over sprawling ones, then
      // smaller span as a cheap-to-include tiebreak.
      const rankedClusters = clusters
        .map((c, i) => ({ idx: i, span: c.end - c.start + 1, c }))
        .sort((a, b) => {
          if (b.c.maxImportance !== a.c.maxImportance) return b.c.maxImportance - a.c.maxImportance;
          const densityA = a.c.score / a.span;
          const densityB = b.c.score / b.span;
          if (densityB !== densityA) return densityB - densityA;
          if (b.c.score !== a.c.score) return b.c.score - a.c.score;
          return a.span - b.span;
        });

      // Per-file budget is the SMALLER of the per-file cap and what's left of the
      // total output cap — so selection (which ranks by importance) keeps the
      // high-importance clusters and drops peripheral ones, instead of the
      // downstream source-order trim slicing off whatever comes last in the file.
      // That source-order slice is what cut Django's `_fetch_all` (L2237, importance
      // 9 — agent-named) when query.py was the last of four big files to be emitted.
      const fileBudget = Math.min(budget.maxCharsPerFile, Math.max(0, budget.maxOutputChars - totalChars - 200));
      const chosenIndices = new Set<number>();
      let projectedChars = 0;
      for (const rc of rankedClusters) {
        const sectionLen = buildSection(rc.c).length + (chosenIndices.size > 0 ? GAP_MARKER.length : 0);
        // Always take the top-ranked cluster, even if oversize, so we don't
        // return an empty file section (agent would then re-Read the file,
        // negating the savings).
        if (chosenIndices.size === 0) {
          chosenIndices.add(rc.idx);
          projectedChars += sectionLen;
          continue;
        }
        if (projectedChars + sectionLen > fileBudget) continue;
        chosenIndices.add(rc.idx);
        projectedChars += sectionLen;
      }

      // Emit chosen clusters in source order so the file reads top-to-bottom.
      let fileSection = '';
      const allSymbols: string[] = [];
      for (let i = 0; i < clusters.length; i++) {
        if (!chosenIndices.has(i)) continue;
        const cluster = clusters[i]!;
        const sectionBudget = Math.max(1200, fileBudget - fileSection.length - (fileSection.length > 0 ? GAP_MARKER.length : 0));
        const rendered = truncateOversizedSourceRange(buildSection(cluster), sectionBudget);
        const section = rendered.text;
        if (rendered.truncated) anyFileTrimmed = true;
        if (fileSection.length > 0) fileSection += GAP_MARKER;
        fileSection += section;
        allSymbols.push(...cluster.symbols);
      }

      // A chosen cluster is normally a complete method-range. The one exception
      // is a monolithic function larger than the entire per-file window: returning
      // no source is worse than returning an honest line-numbered window, so the
      // oversized range is cut at a line boundary with an explicit marker.
      if (chosenIndices.size < clusters.length) {
        anyFileTrimmed = true;
      }
      anyPartialSourceView = true;

      // Dedupe + cap the symbols list shown in the per-file header. Some
      // files (Session.swift in Alamofire) produced 3.4KB symbol lists
      // from cluster scoring + edge-source lines, dwarfing the per-file
      // body cap. Show top names by frequency, with a "+N more" tail.
      const symbolCounts = new Map<string, number>();
      for (const s of allSymbols) {
        symbolCounts.set(s, (symbolCounts.get(s) ?? 0) + 1);
      }
      const sortedSymbols = [...symbolCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name);
      const headerCap = budget.maxSymbolsInFileHeader;
      const headerSymbols = sortedSymbols.slice(0, headerCap);
      const omittedCount = sortedSymbols.length - headerSymbols.length;
      const headerSuffix = omittedCount > 0
        ? `${headerSymbols.join(', ')}, +${omittedCount} more`
        : headerSymbols.join(', ');
      const fileHeader = `#### ${filePath} — ${headerSuffix}`;

      // The total cap bounds INCIDENTAL files only. A file that DEFINES a symbol
      // the agent named (or that's on the flow spine) renders even when the
      // nominal total is used up — it's the answer, and the set is bounded by
      // maxFiles AND by true-spine/named-seeding having already trimmed each file
      // to its necessary content. A file that merely REFERENCES the flow
      // (Combine.swift name-drops request/task) is incidental → still capped, so
      // freed budget never leaks into noise. This is the last god-file layer:
      // build (Session, true-spined) + validators-exec (Request) + validate
      // (DataRequest/Validation) all render, instead of the cap dropping whichever
      // phase the file order happened to put last.
      if (!fileNecessary && totalChars + fileSection.length + 200 > budget.maxOutputChars) {
        // Incidental file that doesn't fit: SKIP it whole — never slice mid-method.
        // Keep scanning for necessary files (which bypass this cap and render in
        // full, bounded by the hard ceiling).
        anyFileTrimmed = true;
        continue;
      }

      lines.push(fileHeader);
      lines.push('');
      lines.push('```' + lang);
      lines.push(fileSection);
      lines.push('```');
      lines.push('');

      totalChars += fileSection.length + 200;
      filesIncluded++;
      shownSourceFiles.add(filePath);
    }

    const hiddenCandidateFiles = sortedFiles.filter(([filePath]) => !shownSourceFiles.has(filePath)).length;
    lines[coverageLineIndex] = [
      `Candidate graph: ${subgraph.nodes.size} symbols across ${sortedFiles.length} source-candidate files.`,
      `Source shown below covers ${filesIncluded} file${filesIncluded === 1 ? '' : 's'}${hiddenCandidateFiles > 0 ? `; ${hiddenCandidateFiles} candidate file${hiddenCandidateFiles === 1 ? '' : 's'} not shown in this call.` : '; all candidate files are shown in this call.'}`,
    ].join(' ');

    // Add remaining files as references (from both relevant and peripheral files).
    // Small projects (per budget) skip this — the relevant story already fits
    // in the source section, and a trailing pointer list is pure overhead.
    if (budget.includeAdditionalFiles) {
      const allowLowSignalAdditionalFiles = queryAllowsLowSignalSources(query);
      const shouldShowAdditionalFile = (filePath: string): boolean =>
        !shownSourceFiles.has(filePath) && (allowLowSignalAdditionalFiles || !isLowValue(filePath));
      const remainingRelevant = sortedFiles.filter(([filePath]) => shouldShowAdditionalFile(filePath));
      const peripheralFiles = [...fileGroups.entries()]
        .filter(([filePath, group]) => group.score < 3 && shouldShowAdditionalFile(filePath))
        .sort((a, b) => b[1].score - a[1].score);
      const remainingFiles = [...remainingRelevant, ...peripheralFiles];
      if (remainingFiles.length > 0) {
        lines.push('### Not shown above — explore these names for their source');
        lines.push('');
        for (const [filePath, group] of remainingFiles.slice(0, 10)) {
          const symbols = group.nodes.map(n => `${n.name}:${n.startLine}`).join(', ');
          lines.push(`- ${filePath}: ${symbols}`);
        }
        if (remainingFiles.length > 10) {
          lines.push(`- ... and ${remainingFiles.length - 10} more files`);
        }
      }
    }

    // Supporting graph facts are valuable, but source is the primary contract of
    // explore. Keep relationships after source so a tight inline ceiling drops
    // support metadata before it drops every verbatim code block.
    if (relationshipLines.length > 0) {
      lines.push('');
      lines.push(...relationshipLines);
    }

    // Add completeness signal so agents know they don't need to re-read these files.
    // On small projects the budget gates this off — but if we actually had to
    // trim or drop clusters, surface a brief note so the agent knows it can
    // still Read for more detail.
    if (budget.includeCompletenessSignal && !anyPartialSourceView && !anyFileTrimmed) {
      lines.push('');
      lines.push('---');
      const followUp = outputSurface === 'cli'
        ? 'make ANOTHER `omniweave explore "<names>"` call targeting those names'
        : 'make ANOTHER omniweave_explore targeting those names';
      lines.push(`> **Complete source for ${filesIncluded} files is included above — do NOT re-read them.** If your question also needs files/symbols listed under "Not shown above" (or any area this call didn't cover), ${followUp} — it returns the same source with line numbers and is cheaper and more complete than reading. Reserve Read for a single specific line range explore can't surface.`);
    } else if (budget.includeCompletenessSignal || anyFileTrimmed) {
      lines.push('');
      const followUp = outputSurface === 'cli'
        ? 'run `omniweave explore "<symbol>"` or `omniweave node "<symbol>"`'
        : 'run another `omniweave_explore` (or `omniweave_node`)';
      lines.push(`> Source shown above is complete only for the displayed blocks/ranges; some file ranges or candidate files may be omitted for size. For a specific symbol you still need, ${followUp} with its exact name — line-numbered source, cheaper and more complete than Read.`);
    }

    // Add explore budget note based on project size
    if (budget.includeBudgetNote) {
      try {
        const stats = cg.getStats();
        const callBudget = getExploreBudget(stats.fileCount);
        lines.push('');
        lines.push(`> **Explore budget: ${callBudget} calls for this project (${stats.fileCount.toLocaleString()} files indexed).** Each call covers ~6 files; if your question spans more, spend your remaining calls on the uncovered area BEFORE falling back to Read — another explore is cheaper and more complete than reading those files. Synthesize once you've used ${callBudget}.`);
      } catch {
        // Stats unavailable — skip budget note
      }
    }

    // Final ceiling — an ABSOLUTE inline cap, not a multiple of the budget. The
    // render loop renders necessary (named/spine) files even a bit past
    // maxOutputChars and caps only incidental ones, so this is the last safety.
    // It MUST stay under the host's inline tool-result limit (~25K chars): above
    // that the result is externalized to a file the agent Reads back (a 35K
    // vscode explore did exactly this in the n=4 A/B). So allow a little
    // necessary overflow above the 24K budget, but hard-stop at 25K — never into
    // externalize territory.
    const output = flow.text + lines.join('\n');
    const hardCeiling = Math.min(Math.round(budget.maxOutputChars * 1.5), EXPLORE_INLINE_HARD_CEILING);
    if (output.length > hardCeiling) {
      const retry = outputSurface === 'cli'
        ? 'run another `omniweave explore "<names>"` with the specific names'
        : 'run another omniweave_explore with the specific names';
      const suffix = `\n\n... (output truncated to budget; trailing sections were dropped whole to keep this inline and avoid partial source. Treat only complete source blocks shown above as already Read. For uncovered names/files, ${retry}.)`;
      // Cut at a COMPLETE source-block boundary and reserve room for the suffix,
      // otherwise the hard ceiling can still spill over after the marker.
      return this.textResult(truncateExploreAtCompleteBoundary(output, hardCeiling, suffix));
    }
    return this.textResult(output);
  }

  /**
   * Handle omniweave_node
   */
  private async handleNode(
    args: Record<string, unknown>,
    outputSurface: OutputSurface = 'mcp',
  ): Promise<ToolResult> {
    const cg = this.getOmniWeave(args.projectPath as string | undefined);
    // Default to false to minimize context usage
    const includeCode = args.includeCode === true;
    const fileHint = typeof args.file === 'string' && args.file.trim() ? args.file.trim() : undefined;
    const lineHint = typeof args.line === 'number' && args.line > 0 ? args.line : undefined;
    const offset = typeof args.offset === 'number' && args.offset > 0 ? Math.floor(args.offset) : undefined;
    const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : undefined;
    const symbolsOnly = args.symbolsOnly === true;
    const symbolRaw = typeof args.symbol === 'string' ? args.symbol.trim() : '';

    // FILE READ MODE: a `file` with no `symbol` reads that file like the Read
    // tool — its current on-disk source with line numbers, narrowable with
    // `offset`/`limit` exactly as Read does — PLUS a one-line blast-radius
    // header (which files depend on it). `symbolsOnly` returns just the
    // structural map instead. Backed by the index: same bytes Read gives you.
    if (!symbolRaw && fileHint) {
      return this.handleFileView(cg, fileHint, { offset, limit, symbolsOnly, outputSurface });
    }

    const symbol = this.validateString(args.symbol, 'symbol');
    if (typeof symbol !== 'string') return symbol;

    let matches = this.findSymbolMatches(cg, symbol);
    if (matches.length === 0) {
      return this.textResult(`Symbol "${symbol}" not found in the codebase`);
    }

    // Disambiguate a heavily-overloaded name to a specific definition the caller
    // pinned by file/line (the `file:line` a trail or another tool showed it) —
    // so it can fetch e.g. `Harness::poll` at harness.rs:153 out of 50+ `poll`s
    // instead of Reading. file matches by path suffix/substring; line prefers the
    // def whose body contains it, else the nearest start. Only narrows (never
    // empties — if a hint matches nothing it's ignored).
    if (matches.length > 1 && (fileHint || lineHint !== undefined)) {
      const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
      let narrowed = matches;
      if (fileHint) {
        const projectRootNorm = norm(cg.getProjectRoot()).replace(/\/+$/, '');
        const rawHint = norm(fileHint);
        const relativeHint = rawHint.startsWith(`${projectRootNorm}/`)
          ? rawHint.slice(projectRootNorm.length + 1)
          : rawHint;
        const hintCandidates = [...new Set([
          rawHint,
          relativeHint,
          relativeHint.split('/').filter(Boolean).pop() ?? relativeHint,
        ].filter((h) => h.length > 0))];
        const matchRank = (n: Node): { low: number; specificity: number; length: number } => {
          const fp = norm(n.filePath);
          const basename = hintCandidates[hintCandidates.length - 1] ?? relativeHint;
          let specificity = 3;
          if (fp === relativeHint) specificity = 0;
          else if (fp.endsWith(`/${relativeHint}`) || fp.endsWith(relativeHint)) specificity = 1;
          else if (fp.endsWith(`/${basename}`)) specificity = 2;
          return {
            low: isLowSignalSourceFile(n.filePath) ? 1 : 0,
            specificity,
            length: n.filePath.length,
          };
        };
        const byFile = narrowed
          .filter((n) => {
            const fp = norm(n.filePath);
            return hintCandidates.some((h) => fp === h || fp.endsWith(`/${h}`) || fp.endsWith(h) || fp.includes(h));
          })
          .sort((a, b) => {
            const ar = matchRank(a);
            const br = matchRank(b);
            return ar.low - br.low || ar.specificity - br.specificity || ar.length - br.length;
          });
        if (byFile.length > 0) {
          const best = matchRank(byFile[0]!);
          narrowed = byFile.filter((n) => {
            const rank = matchRank(n);
            return rank.low === best.low && rank.specificity === best.specificity && rank.length === best.length;
          });
        }
      }
      if (lineHint !== undefined && narrowed.length > 1) {
        const containing = narrowed.filter((n) => n.startLine <= lineHint && (n.endLine ?? n.startLine) >= lineHint);
        narrowed = containing.length > 0
          ? containing
          : [...narrowed].sort((a, b) => Math.abs(a.startLine - lineHint) - Math.abs(b.startLine - lineHint)).slice(0, 1);
      }
      if (narrowed.length > 0) matches = narrowed;
    }

    // Single definition — the common case.
    if (matches.length === 1) {
      const node = matches[0]!;
      const rendered = await this.renderNodeSection(cg, node, includeCode, outputSurface);
      return this.textResult(includeCode
        ? this.truncateNodeOutput(rendered, node, outputSurface)
        : this.truncateOutput(rendered));
    }

    // Multiple definitions share this name — overloads, or same-named methods on
    // different types (Alamofire `didCompleteTask`/`task`/`validate`, gin
    // `reset`). Returning ONE forces the agent to guess, and when it guesses
    // wrong it READS the file to find the right overload — the dominant
    // omniweave_node read cause on Swift/Go. So return them ALL: pack as many
    // FULL bodies as fit a char budget (the agent gets the one it needs in this
    // one call, no follow-up parameter to learn), and list any remainder by
    // file:line so a large overload set can't overflow the per-tool cap.
    const header = `**${matches.length} definitions named "${symbol}"**`;
    if (!includeCode) {
      const list = matches.map((n) => `- \`${n.name}\` (${n.kind}) — ${n.filePath}:${n.startLine}`);
      const retry = outputSurface === 'cli'
        ? 'Re-run `omniweave node <symbol>` with `--file` or `--line` to pin one definition'
        : 'Re-query with `includeCode: true` to get every body in one call';
      return this.textResult(this.truncateOutput(
        [header, '', `${retry} — no need to pick one first.`, '', ...list].join('\n'),
      ));
    }

    const BODY_BUDGET = 12000; // leaves room under MAX_OUTPUT_LENGTH for the header + list
    // The CHAR budget is the real limiter — keep the count cap high so a set of
    // SHORT overloads (Alamofire's 10 `validate` variants, each a few lines) all
    // render in full rather than relegating the one the agent wanted to a
    // bodiless list. Only a set of many LARGE bodies hits the char budget first.
    const HARD_CAP = 16;
    const rendered: string[] = [];
    const listed: Node[] = [];
    let used = 0;
    for (const n of matches) {
      if (rendered.length >= HARD_CAP) { listed.push(n); continue; }
      const section = await this.renderNodeSection(cg, n, true, outputSurface);
      // Always emit the first; emit the rest only while within the char budget.
      if (rendered.length === 0 || used + section.length <= BODY_BUDGET) {
        rendered.push(section);
        used += section.length;
      } else {
        listed.push(n);
      }
    }

    const out: string[] = [
      header,
      `Returning ${rendered.length} in full${listed.length ? `; ${listed.length} more listed below` : ''} — pick the one you need (no Read required).`,
      '',
      rendered.join('\n\n---\n\n'),
    ];
    if (listed.length) {
      const LIST_CAP = 20;
      const shownList = listed.slice(0, LIST_CAP);
      out.push(
        '',
        '### Other definitions',
        ...shownList.map((n) => `- \`${n.name}\` (${n.kind}) — ${n.filePath}:${n.startLine}`),
      );
      if (listed.length > LIST_CAP) out.push(`- … +${listed.length - LIST_CAP} more`);
      const retry = outputSurface === 'cli'
        ? `Run \`${this.cliNodeCommand(listed[0]!)}\` for one listed definition — do NOT Read it.`
        : `Call omniweave_node again with \`file\` (e.g. \`"${listed[0]!.filePath.split('/').pop()}"\`) or \`line\` — do NOT Read it.`;
      out.push(
        '',
        `> Need one of these in full? ${retry}`,
      );
    }
    return this.textResult(this.truncateOutput(out.join('\n')));
  }

  /**
   * FILE READ MODE: resolve `fileArg` (path or basename) to an indexed file and
   * read it like the Read tool — its current on-disk source with line numbers,
   * narrowable with `offset`/`limit` exactly as Read's are — preceded by a
   * one-line blast-radius header (which files depend on it). `symbolsOnly`
   * returns just the structural map (symbols + dependents) instead of source.
   *
   * Parity goal: the numbered source block is byte-for-byte the shape Read
   * returns (`<n>\t<line>`, no padding), so the agent treats it as a Read — only
   * faster (served from the index) and with the blast radius attached. Security:
   * yaml/properties files are summarized by key, never dumped (#383); reads go
   * through validatePathWithinRoot (#527).
   */
  private async handleFileView(
    cg: OmniWeave,
    fileArg: string,
    opts: { offset?: number; limit?: number; symbolsOnly?: boolean; outputSurface?: OutputSurface } = {},
  ): Promise<ToolResult> {
    const normalize = (p: string) => p.replace(/\\/g, '/').replace(/^(?:\.?\/+)+/, '').replace(/\/+$/, '');
    const wantLower = normalize(fileArg).toLowerCase();
    const allFiles = cg.getFiles();
    if (allFiles.length === 0) return this.textResult(emptyIndexMessage(opts.outputSurface));

    let resolved = allFiles.find((f) => f.path.toLowerCase() === wantLower);
    let candidates: typeof allFiles = [];
    if (!resolved) {
      candidates = allFiles.filter((f) => f.path.toLowerCase().endsWith('/' + wantLower));
      if (candidates.length === 1) resolved = candidates[0];
    }
    if (!resolved && candidates.length === 0) {
      candidates = allFiles.filter((f) => f.path.toLowerCase().includes(wantLower));
      if (candidates.length === 1) resolved = candidates[0];
    }
    if (!resolved && candidates.length > 1) {
      return this.textResult(
        [`"${fileArg}" matches ${candidates.length} indexed files — pass a longer path:`, '',
          ...candidates.slice(0, 25).map((f) => `- ${f.path}`)].join('\n'),
      );
    }
    if (!resolved) {
      return this.textResult(
        `No indexed file matches "${fileArg}". OmniWeave indexes source files; configs/docs it doesn't parse won't appear — Read those directly.`,
      );
    }

    const filePath = resolved.path;
    const nodes = cg.getNodesInFile(filePath)
      .filter((n) => n.kind !== 'file' && n.kind !== 'import' && n.kind !== 'export')
      .sort((a, b) => a.startLine - b.startLine);
    const dependents = cg.getFileDependents(filePath);

    // Compact, one-line blast radius (omniweave's value-add over a plain Read).
    const depSummary = dependents.length
      ? `used by ${dependents.length} file${dependents.length === 1 ? '' : 's'}: ${dependents.slice(0, 8).join(', ')}${dependents.length > 8 ? `, +${dependents.length - 8} more` : ''}`
      : 'no other indexed file depends on it';

    // Symbol-map renderer — for symbolsOnly, the config fallback, and read errors.
    const symbolMap = (heading: string, limit = 200): string[] => {
      const lines: string[] = [heading];
      for (const n of nodes.slice(0, limit)) {
        const sig = n.signature ? ` ${n.signature.replace(/\s+/g, ' ').trim()}` : '';
        lines.push(`- \`${n.name}\` (${n.kind})${sig} — :${n.startLine}`);
      }
      if (nodes.length > limit) lines.push(`- … +${nodes.length - limit} more`);
      return lines;
    };

    // symbolsOnly → the cheap structural overview, no source.
    if (opts.symbolsOnly) {
      const out = [`**${filePath}** — ${nodes.length} symbol${nodes.length === 1 ? '' : 's'}, ${depSummary}`, ''];
      if (nodes.length) out.push(...symbolMap('### Symbols'));
      else out.push('_No indexed symbols in this file._');
      out.push('', '> Drop `symbolsOnly` (or pass `offset`/`limit`) to read the source, like Read.');
      return this.textResult(this.truncateOutput(out.join('\n')));
    }

    // SECURITY (#383): never dump a raw config/data file — a yaml/properties
    // line is `key: <secret>`. Summarize by key and point to a real Read.
    if (CONFIG_LEAF_LANGUAGES.has(resolved.language)) {
      const out = [`**${filePath}** — configuration/data file, ${depSummary}`, ''];
      if (nodes.length) out.push(...symbolMap('### Keys (values withheld for safety)'));
      out.push('', '> Values may be secrets, so omniweave indexes keys only. Read the file directly if you need a value.');
      return this.textResult(this.truncateOutput(out.join('\n')));
    }

    // Read the current bytes from disk through the security chokepoint
    // (validatePathWithinRoot: blocks `../` traversal and symlink escapes, #527).
    const abs = validatePathWithinRoot(cg.getProjectRoot(), filePath);
    let content: string | null = null;
    if (abs) {
      try { content = readFileSync(abs, 'utf-8'); } catch { content = null; }
    }
    if (content === null) {
      const out = [`**${filePath}** — could not read from disk (it may have moved since indexing). ${depSummary}`, ''];
      if (nodes.length) out.push(...symbolMap('### Symbols'));
      out.push('', `> Read \`${filePath}\` directly for its current content.`);
      return this.textResult(this.truncateOutput(out.join('\n')));
    }

    // Split exactly as Read does — keep the trailing empty line a final newline
    // produces (Read numbers it too), so line numbers line up byte-for-byte.
    const fileLines = content.split('\n');
    const total = fileLines.length;

    // Read-parity windowing: `offset`/`limit` mean exactly what they do on Read
    // (1-based start line; max line count). Default: the whole file, capped like
    // Read at 2000 lines and bounded by a char budget that tracks explore's
    // proven-safe ~38k response ceiling. Overflow is stated explicitly (Read
    // paginates too) — never the silent 15k truncateOutput chop.
    const CHAR_BUDGET = 38000;
    const DEFAULT_LIMIT = 2000;
    const offset = Math.max(1, opts.offset ?? 1);
    if (offset > total) {
      return this.textResult(`**${filePath}** has ${total} line${total === 1 ? '' : 's'} — offset ${offset} is past the end. ${depSummary}`);
    }
    const maxLines = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
    const start = offset - 1; // 0-based
    const header = `**${filePath}** — ${total} lines, ${nodes.length} symbol${nodes.length === 1 ? '' : 's'} · ${depSummary}`;

    // Numbered lines, byte-for-byte Read's shape: `<n>\t<line>`, no left-pad.
    const numbered: string[] = [];
    let used = header.length + 8;
    let i = start;
    for (; i < total && numbered.length < maxLines; i++) {
      const ln = `${i + 1}\t${fileLines[i]}`;
      if (used + ln.length + 1 > CHAR_BUDGET && numbered.length > 0) break;
      numbered.push(ln);
      used += ln.length + 1;
    }
    const shownEnd = start + numbered.length;
    const complete = offset === 1 && shownEnd >= total;

    const out: string[] = [header, '', ...numbered];
    if (!complete) {
      const nextRange = opts.outputSurface === 'cli'
        ? '`--offset`/`--limit`'
        : '`offset`/`limit`';
      const oneSymbol = opts.outputSurface === 'cli'
        ? '`omniweave node <symbol>`'
        : '`omniweave_node <symbol>`';
      out.push(
        '',
        `(lines ${offset}–${shownEnd} of ${total} — pass ${nextRange} for another range, or ${oneSymbol} for one symbol in full)`,
      );
    }
    // Self-bounded to CHAR_BUDGET — do NOT route through truncateOutput (15k).
    return this.textResult(out.join('\n'));
  }

  /** Render one symbol: details + (optional) body/outline + its caller/callee trail. */
  private async renderNodeSection(
    cg: OmniWeave,
    node: Node,
    includeCode: boolean,
    outputSurface: OutputSurface = 'mcp',
  ): Promise<string> {
    let code: string | null = null;
    let outline: string | null = null;
    if (includeCode) {
      // For container symbols (class/interface/struct/…), the full body is the
      // sum of every method body — a wall of source. Return a structural outline
      // (members + signatures + line numbers) instead; leaf symbols return their
      // full body.
      if (CONTAINER_NODE_KINDS.has(node.kind)) {
        outline = this.buildContainerOutline(cg, node);
      }
      if (!outline) {
        code = await cg.getCode(node.id);
      }
    }
    return this.formatNodeDetails(node, code, outline, outputSurface, this.formatTrail(cg, node, outputSurface));
  }

  /**
   * Build the "trail" for a symbol: its direct callees (what it calls) and
   * callers (what calls it), each with file:line — so omniweave_node doubles as
   * the structural Grep→Read→expand primitive: a spot PLUS where to go next.
   * Capped to stay cheap. Walk the graph by calling omniweave_node on a trail
   * entry; no Read needed for covered hops. Empty edges on a non-leaf often mean
   * dynamic dispatch the static graph couldn't resolve — that absence is itself
   * a signal (read that one hop) rather than a dead end.
   */
  private formatTrail(cg: OmniWeave, node: Node, outputSurface: OutputSurface = 'mcp'): string {
    const TRAIL_CAP = 12;
    const sourceIsLowSignal = isLowSignalSourceFile(node.filePath);
    let omittedLowSignal = 0;
    let omittedWeak = 0;
    const fmt = (e: { node: Node; edge: Edge }) => {
      const base = `${e.node.name} (${e.node.filePath}:${e.node.startLine}; ${this.nodeContinuationLabel(e.node, outputSurface)})`;
      const synth = this.synthEdgeNote(e.edge);
      return synth ? `${base} [${synth.compact}]` : base;
    };
    const collect = (edges: Array<{ node: Node; edge: Edge }>): Array<{ node: Node; edge: Edge }> => {
      const seen = new Set<string>([node.id]);
      const out: Array<{ node: Node; edge: Edge }> = [];
      for (const e of edges) {
        // Consistent with omniweave_callers/callees: an `import` edge is a
        // dependency, not a call — keep it out of the call trail.
        if (!CALL_SURFACE_EDGE_KINDS.has(e.edge.kind)) {
          omittedWeak++;
          continue;
        }
        if (!sourceIsLowSignal && isLowSignalSourceFile(e.node.filePath)) {
          omittedLowSignal++;
          continue;
        }
        if (seen.has(e.node.id)) continue;
        seen.add(e.node.id);
        out.push(e);
      }
      return out;
    };
    const callees = collect(cg.getCallees(node.id));
    const callers = collect(cg.getCallers(node.id));
    if (callees.length === 0 && callers.length === 0 && omittedLowSignal === 0 && omittedWeak === 0) return '';
    const trailTool = outputSurface === 'cli' ? '`omniweave node`' : 'omniweave_node';
    const lines: string[] = ['', `### Trail — ${trailTool} any of these to follow it (no Read needed)`];
    if (callees.length > 0) {
      lines.push(`**Calls →** ${callees.slice(0, TRAIL_CAP).map(fmt).join(', ')}${callees.length > TRAIL_CAP ? `, +${callees.length - TRAIL_CAP} more` : ''}`);
    }
    if (callers.length > 0) {
      lines.push(`**Called by ←** ${callers.slice(0, TRAIL_CAP).map(fmt).join(', ')}${callers.length > TRAIL_CAP ? `, +${callers.length - TRAIL_CAP} more` : ''}`);
    }
    if (omittedLowSignal > 0) {
      lines.push(`_Omitted ${omittedLowSignal} low-signal trail hop${omittedLowSignal === 1 ? '' : 's'} from test/example/research snapshot sources; inspect those paths explicitly if that support corpus is the target._`);
    }
    if (omittedWeak > 0) {
      lines.push(`_Omitted ${omittedWeak} non-execution reference/type/import edge${omittedWeak === 1 ? '' : 's'} from this call trail; use impact/explore when dependency closure matters._`);
    }
    return lines.join('\n');
  }

  /**
   * Handle omniweave_status
   */
  private async handleStatus(args: Record<string, unknown>): Promise<ToolResult> {
    let cg = this.getOmniWeave(args.projectPath as string | undefined);
    // Same trick as withStalenessNotice — when an explicit projectPath
    // resolves to the same project as the default session cg, prefer the
    // default so getPendingFiles() (only populated by the default's watcher)
    // is non-empty when there are pending edits.
    if (this.cg && cg !== this.cg) {
      try {
        if (resolvePath(this.cg.getProjectRoot()) === resolvePath(cg.getProjectRoot())) {
          cg = this.cg;
        }
      } catch { /* closed instance — leave as is */ }
    }
    const stats = cg.getStats();
    const snapshotImport = cg.getSnapshotImportInfo();
    const currentBuildFingerprint = readCurrentBuildFingerprint();
    const buildSkew = runtimeBuildSkew(OmniWeaveBuildFingerprint, currentBuildFingerprint);

    // Warn when this index actually belongs to a different git working tree
    // (e.g. the server resolved up from a nested worktree to the main checkout).
    // Queries then reflect that tree's branch, not the worktree being edited.
    // status shows the verbose, multi-line form; the read tools get the compact
    // one-liner via withWorktreeNotice. Both share the cached detection.
    const mismatch = this.worktreeMismatchFor(args.projectPath as string | undefined);

    const lines: string[] = [
      '## OmniWeave Status',
      '',
    ];
    if (mismatch) {
      lines.push(`> ⚠ ${worktreeMismatchWarning(mismatch).replace(/\n/g, '\n> ')}`, '');
    }
    if (snapshotImport) {
      lines.push(
        `> ⚠ ${describeSnapshotImportWarning(snapshotImport)}`,
        ''
      );
    }
    if (buildSkew) {
      lines.push(
        `> ⚠ ${runtimeBuildSkewMessage(buildSkew)}`,
        ''
      );
    }
    lines.push(
      `**Files indexed:** ${stats.fileCount}`,
      `**Total nodes:** ${stats.nodeCount}`,
      `**Total edges:** ${stats.edgeCount}`,
      `**Database size:** ${(stats.dbSizeBytes / 1024 / 1024).toFixed(2)} MB`,
      `**Runtime build:** ${OmniWeaveBuildFingerprint}`,
    );
    if (buildSkew) {
      lines.push(`**Current disk build:** ${currentBuildFingerprint}`);
    }

    // Surface the active SQLite backend (node:sqlite, Node's built-in real
    // SQLite — full WAL + FTS5, no native build).
    lines.push(`**Backend:** node:sqlite (Node built-in) — full WAL + FTS5`);

    // Effective journal mode. 'wal' ⇒ concurrent reads never block on a writer;
    // anything else ⇒ they can ("database is locked"). node:sqlite supports WAL
    // everywhere, so a non-wal mode means the filesystem can't (network/
    // virtualized mounts, WSL2 /mnt). See issue #238.
    const journalMode = cg.getJournalMode();
    if (journalMode === 'wal') {
      lines.push(`**Journal mode:** wal (concurrent reads safe)`);
    } else {
      lines.push(
        `**Journal mode:** ⚠ ${journalMode || 'unknown'} — WAL not active, so reads ` +
        `can block on a concurrent write (WAL appears unsupported on this filesystem)`
      );
    }

    lines.push('', '### Nodes by Kind:');

    for (const [kind, count] of Object.entries(stats.nodesByKind)) {
      if ((count as number) > 0) {
        lines.push(`- ${kind}: ${count}`);
      }
    }

    lines.push('', '### Languages:');
    for (const [lang, count] of Object.entries(stats.filesByLanguage)) {
      if ((count as number) > 0) {
        lines.push(`- ${lang}: ${count}`);
      }
    }

    // Per-file freshness — the inverse of the auto-prepended staleness banner
    // (issue #403). Surfacing it inside `status` gives the agent a single
    // place to ask "is the index caught up?" rather than inferring from
    // banners on other tool calls.
    const pending = cg.getPendingFiles();
    if (pending.length > 0) {
      lines.push('', '### Pending sync:');
      const now = Date.now();
      for (const p of pending) {
        const ageMs = Math.max(0, now - p.lastSeenMs);
        const label = p.indexing ? 'indexing in progress' : 'pending sync';
        lines.push(`- ${p.path} (edited ${ageMs}ms ago, ${label})`);
      }
    } else {
      const allChanged = changedFileEntries(cg.getChangedFiles());
      const sourceChanged = changedFileEntries(cg.getChangedSourceFiles?.() ?? cg.getChangedFiles());
      const { firstParty: firstPartySourceChanged, lowSignal: lowSignalSourceChanged } =
        partitionLowSignalChangedEntries(sourceChanged);
      const rawContentMaintenance = subtractChangedEntries(allChanged, sourceChanged);
      if (firstPartySourceChanged.length > 0) {
        lines.push('', '### Source graph changes since last index:');
        pushCappedChangedEntries(lines, firstPartySourceChanged);
        lines.push('', 'Run `omniweave sync` before trusting structural relationships.');
      }
      if (lowSignalSourceChanged.length > 0) {
        lines.push('', '### Low-signal source maintenance:');
        pushCappedChangedEntries(lines, lowSignalSourceChanged);
        lines.push('', 'These are test/example/research snapshot sources filtered out of default retrieval.');
      }
      if (rawContentMaintenance.length > 0) {
        lines.push('', '### Raw-content index maintenance:');
        pushCappedChangedEntries(lines, rawContentMaintenance);
        lines.push('', 'These affect raw-content search/snippets, not structural calls/imports.');
      }
    }

    return this.textResult(lines.join('\n'));
  }

  /**
   * Handle omniweave_files - get project file structure from the index
   */
  private async handleFiles(args: Record<string, unknown>, outputSurface: OutputSurface = 'mcp'): Promise<ToolResult> {
    const cg = this.getOmniWeave(args.projectPath as string | undefined);
    const pathFilter = args.path as string | undefined;
    const pattern = args.pattern as string | undefined;
    const format = (args.format as 'tree' | 'flat' | 'grouped') || 'tree';
    const includeMetadata = args.includeMetadata !== false;
    const maxDepth = args.maxDepth != null ? clamp(args.maxDepth as number, 1, 20) : undefined;

    // Get all files from the index
    const allFiles = cg.getFiles();

    if (allFiles.length === 0) {
      return this.textResult(emptyIndexMessage(outputSurface));
    }

    // Filter by path prefix. Stored paths are project-relative POSIX (e.g.
    // "src/foo.ts"), but agents commonly pass project-root variants like "/",
    // ".", "./", "" or Windows-style "src\foo" — and prefixes with leading
    // "/", "./" or "\". Normalize all of those before matching so the agent
    // gets results instead of falling back to Read/Glob (see #426).
    const normalizedFilter = pathFilter
      ? pathFilter
          .replace(/\\/g, '/')
          .replace(/^(?:\.?\/+)+/, '')
          .replace(/^\.$/, '')
          .replace(/\/+$/, '')
      : '';
    let files = normalizedFilter
      ? allFiles.filter(f => f.path === normalizedFilter || f.path.startsWith(normalizedFilter + '/'))
      : allFiles;

    // Filter by glob pattern
    if (pattern) {
      const regex = this.globToRegex(pattern);
      files = files.filter(f => regex.test(f.path));
    }

    if (files.length === 0) {
      return this.textResult(`No files found matching the criteria.`);
    }

    // Format output
    let output: string;
    switch (format) {
      case 'flat':
        output = this.formatFilesFlat(files, includeMetadata);
        break;
      case 'grouped':
        output = this.formatFilesGrouped(files, includeMetadata);
        break;
      case 'tree':
      default:
        output = this.formatFilesTree(files, includeMetadata, maxDepth);
        break;
    }

    return this.textResult(this.truncateOutput(output));
  }

  /**
   * Convert glob pattern to regex
   */
  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special regex chars except * and ?
      .replace(/\*\*/g, '{{GLOBSTAR}}')       // Temp placeholder for **
      .replace(/\*/g, '[^/]*')                // * matches anything except /
      .replace(/\?/g, '[^/]')                 // ? matches single char except /
      .replace(/\{\{GLOBSTAR\}\}/g, '.*');    // ** matches anything including /
    return new RegExp(escaped);
  }

  /**
   * Format files as a flat list
   */
  private formatFilesFlat(files: { path: string; language: string; nodeCount: number }[], includeMetadata: boolean): string {
    const lines: string[] = [`## Files (${files.length})`, ''];

    for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
      if (includeMetadata) {
        lines.push(`- ${file.path} (${file.language}, ${file.nodeCount} symbols)`);
      } else {
        lines.push(`- ${file.path}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format files grouped by language
   */
  private formatFilesGrouped(files: { path: string; language: string; nodeCount: number }[], includeMetadata: boolean): string {
    const byLang = new Map<string, typeof files>();

    for (const file of files) {
      const existing = byLang.get(file.language) || [];
      existing.push(file);
      byLang.set(file.language, existing);
    }

    const lines: string[] = [`## Files by Language (${files.length} total)`, ''];

    // Sort languages by file count (descending)
    const sortedLangs = [...byLang.entries()].sort((a, b) => b[1].length - a[1].length);

    for (const [lang, langFiles] of sortedLangs) {
      lines.push(`### ${lang} (${langFiles.length})`);
      for (const file of langFiles.sort((a, b) => a.path.localeCompare(b.path))) {
        if (includeMetadata) {
          lines.push(`- ${file.path} (${file.nodeCount} symbols)`);
        } else {
          lines.push(`- ${file.path}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format files as a tree structure
   */
  private formatFilesTree(
    files: { path: string; language: string; nodeCount: number }[],
    includeMetadata: boolean,
    maxDepth?: number
  ): string {
    // Build tree structure
    interface TreeNode {
      name: string;
      children: Map<string, TreeNode>;
      file?: { language: string; nodeCount: number };
    }

    const root: TreeNode = { name: '', children: new Map() };

    for (const file of files) {
      const parts = file.path.split('/');
      let current = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;

        if (!current.children.has(part)) {
          current.children.set(part, { name: part, children: new Map() });
        }
        current = current.children.get(part)!;

        // If this is the last part, it's a file
        if (i === parts.length - 1) {
          current.file = { language: file.language, nodeCount: file.nodeCount };
        }
      }
    }

    // Render tree
    const lines: string[] = [`## Project Structure (${files.length} files)`, ''];

    const renderNode = (node: TreeNode, prefix: string, isLast: boolean, depth: number): void => {
      if (maxDepth !== undefined && depth > maxDepth) return;

      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';

      if (node.name) {
        let line = prefix + connector + node.name;
        if (node.file && includeMetadata) {
          line += ` (${node.file.language}, ${node.file.nodeCount} symbols)`;
        }
        lines.push(line);
      }

      const children = [...node.children.values()];
      // Sort: directories first, then files, both alphabetically
      children.sort((a, b) => {
        const aIsDir = a.children.size > 0 && !a.file;
        const bIsDir = b.children.size > 0 && !b.file;
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      for (let i = 0; i < children.length; i++) {
        const child = children[i]!;
        const nextPrefix = node.name ? prefix + childPrefix : prefix;
        renderNode(child, nextPrefix, i === children.length - 1, depth + 1);
      }
    };

    renderNode(root, '', true, 0);

    return lines.join('\n');
  }

  // =========================================================================
  // Symbol resolution helpers
  // =========================================================================

  /**
   * Find a symbol by name, handling disambiguation when multiple matches exist.
   * Returns the best match and a note about alternatives if any.
   */
  /**
   * Check if a node matches a symbol query.
   *
   * Accepts simple names (`run`) and three flavors of qualifier:
   *   - dotted     `Session.request`         (TS/JS/Python)
   *   - colon-pair `stage_apply::run`        (Rust, C++, Ruby)
   *   - slash      `configurator/stage_apply` (path-ish)
   *
   * Multi-level qualifiers compose: `crate::configurator::stage_apply::run`
   * works. Rust path prefixes (`crate`, `super`, `self`) are stripped so
   * the canonical `crate::module::symbol` form resolves.
   *
   * Resolution order, last part must always equal `node.name`:
   *   1. Suffix-match against `qualifiedName` (handles class-scoped methods
   *      where the extractor builds the qualified name from the AST stack)
   *   2. File-path containment (handles file-derived modules in Rust/
   *      Python — `stage_apply::run` matches a `run` in `stage_apply.rs`)
   */
  private matchesSymbol(node: Node, symbol: string): boolean {
    // Simple name match
    if (node.name === symbol) return true;
    // File basename match (e.g., "product-card" matches "product-card.liquid")
    if (node.kind === 'file' && node.name.replace(/\.[^.]+$/, '') === symbol) return true;

    // Qualified-name lookups: split on any supported separator. `\w` keeps
    // identifier chars (incl. `_`) intact; everything else is treated as
    // a separator we tolerate.
    if (!/[.\/]|::/.test(symbol)) return false;
    const parts = symbol.split(/::|[./]/).filter((p) => p.length > 0);
    if (parts.length < 2) return false;

    const lastPart = parts[parts.length - 1]!;
    if (node.name !== lastPart) return false;

    // Stage 1: qualified-name suffix match. The extractor joins the
    // semantic hierarchy with `::`, so `Session.request` and
    // `Session::request` both become `Session::request` here.
    const colonSuffix = parts.join('::');
    if (node.qualifiedName.includes(colonSuffix)) return true;

    // Stage 2: file-path containment. Rust modules and Python packages
    // are not in `qualifiedName` — they're encoded in the file path. So
    // `stage_apply::run` matches a `run` in any file whose path
    // contains a `stage_apply` segment (with or without an extension).
    //
    // Filter out Rust path prefixes that have no file-system equivalent.
    const containerHints = parts.slice(0, -1).filter((p) => !RUST_PATH_PREFIXES.has(p));
    if (containerHints.length === 0) return false;

    const segments = node.filePath.split('/').filter((s) => s.length > 0);
    return containerHints.every((hint) =>
      segments.some((seg) => seg === hint || seg.replace(/\.[^.]+$/, '') === hint)
    );
  }

  /**
   * Find ALL definitions matching a name, ranked, so omniweave_node can return
   * every overload instead of guessing one (the wrong guess → a Read). Keepers
   * rank before generated stubs (.pb.go etc.); stable within a group preserves
   * FTS order. Returns [] when nothing matches; a qualified lookup that finds no
   * exact match returns [] rather than a misleading fuzzy file hit (#173); a
   * bare name with no exact match falls back to the single top fuzzy result.
   */
  private findSymbolMatches(cg: OmniWeave, symbol: string): Node[] {
    const isQualified = /[.\/]|::/.test(symbol);

    // For a bare name, enumerate EVERY exact-name definition via the direct index
    // (not FTS, which caps + ranks): tokio's `poll` has 50+ defs and the one the
    // caller wants (`Harness::poll` at harness.rs:153) ranks below any search cut,
    // so it could be neither rendered nor pinned by the file/line disambiguator —
    // and the agent Read it. With the full set, the multi-overload render + the
    // file/line filter can both reach it.
    if (!isQualified) {
      const exact = cg.getNodesByName(symbol);
      if (exact.length > 0) {
        return [...exact].sort((a, b) => (isGeneratedFile(a.filePath) ? 1 : 0) - (isGeneratedFile(b.filePath) ? 1 : 0));
      }
      // No exact match — use the single top fuzzy result (e.g. a file basename).
      const fuzzy = cg.searchNodes(symbol, { limit: 10 });
      return fuzzy[0] ? [fuzzy[0].node] : [];
    }

    // Qualified lookup (`Session.request`, `stage_apply::run`): FTS + matchesSymbol.
    const limit = 50;
    let results = cg.searchNodes(symbol, { limit });

    // FTS strips colons, so `stage_apply::run` searches the literal
    // `stage_applyrun` and finds nothing. Re-search by the bare last part and
    // let `matchesSymbol` filter by qualifier.
    if (isQualified && results.length === 0) {
      const tail = lastQualifierPart(symbol);
      if (tail && tail !== symbol) results = cg.searchNodes(tail, { limit });
    }

    if (results.length === 0) return [];

    const exactMatches = results.filter((r) => this.matchesSymbol(r.node, symbol));
    if (exactMatches.length === 0) {
      // No exact match — a qualified lookup must not fall back to a fuzzy file
      // hit (#173); a bare name may use the single top fuzzy result.
      return isQualified ? [] : results[0] ? [results[0].node] : [];
    }

    // Down-rank generated files (.pb.go, .pulsar.go, _grpc.pb.go, …) so a flow
    // query prefers the keeper implementation over the protobuf-generated stub.
    return [...exactMatches]
      .sort((a, b) => (isGeneratedFile(a.node.filePath) ? 1 : 0) - (isGeneratedFile(b.node.filePath) ? 1 : 0))
      .map((r) => r.node);
  }

  /**
   * Find ALL symbols matching a name. Used by callers/callees/impact to aggregate
   * results across all matching symbols (e.g., multiple classes with an `execute` method).
   */
  private findAllSymbols(cg: OmniWeave, symbol: string): { nodes: Node[]; note: string } {
    let results = cg.searchNodes(symbol, { limit: 50 });

    // Mirror the fallback in `findSymbol` for qualified queries — FTS
    // strips colons, so a module-qualified lookup needs a second pass
    // by the bare last part.
    if (results.length === 0 && /[.\/]|::/.test(symbol)) {
      const tail = lastQualifierPart(symbol);
      if (tail && tail !== symbol) results = cg.searchNodes(tail, { limit: 50 });
    }

    if (results.length === 0) {
      return { nodes: [], note: '' };
    }

    const exactMatches = results.filter(r => this.matchesSymbol(r.node, symbol));

    if (exactMatches.length <= 1) {
      const node = exactMatches[0]?.node ?? results[0]!.node;
      return { nodes: [node], note: '' };
    }

    // Same generated-file down-rank as findSymbol — keeps callers/callees
    // /impact aggregation aligned (a query against "Send" returns the
    // hand-written implementations before the protobuf scaffold).
    const ranked = [...exactMatches].sort((a, b) => {
      const aGen = isGeneratedFile(a.node.filePath) ? 1 : 0;
      const bGen = isGeneratedFile(b.node.filePath) ? 1 : 0;
      return aGen - bGen;
    });

    const nodes = ranked.map(r => r.node);
    return { nodes, note: this.aggregatedSymbolsNote(symbol, nodes) };
  }

  /**
   * Truncate output if it exceeds the maximum length
   */
  private truncateOutput(text: string): string {
    if (text.length <= MAX_OUTPUT_LENGTH) return text;
    const truncated = text.slice(0, MAX_OUTPUT_LENGTH);
    const lastNewline = truncated.lastIndexOf('\n');
    const cutPoint = lastNewline > MAX_OUTPUT_LENGTH * 0.8 ? lastNewline : MAX_OUTPUT_LENGTH;
    return truncated.slice(0, cutPoint) + '\n\n... (output truncated)';
  }

  private truncateNodeOutput(text: string, node: Node, outputSurface: OutputSurface): string {
    if (text.length <= MAX_OUTPUT_LENGTH) return text;
    const line = node.startLine || 1;
    const retry = outputSurface === 'cli'
      ? `run \`omniweave node ${this.cliArg(node.filePath)} --offset ${line} --limit 200\``
      : `call omniweave_node with \`file: "${node.filePath}", offset: ${line}, limit: 200\``;
    const suffix = `\n\n... (output truncated at a complete code fence; ${retry} for the next source window.)`;
    const closeFence = '\n```';
    let cutLimit = MAX_OUTPUT_LENGTH - suffix.length;
    let cut = text.slice(0, Math.max(0, cutLimit));
    let cutPoint = cut.lastIndexOf('\n');
    if (cutPoint <= MAX_OUTPUT_LENGTH * 0.8) cutPoint = cut.length;
    cut = cut.slice(0, cutPoint).trimEnd();

    const fenceCount = (cut.match(/^```/gm) ?? []).length;
    if (fenceCount % 2 === 0) {
      return cut + suffix;
    }

    cutLimit = MAX_OUTPUT_LENGTH - suffix.length - closeFence.length;
    cut = text.slice(0, Math.max(0, cutLimit));
    cutPoint = cut.lastIndexOf('\n');
    if (cutPoint <= MAX_OUTPUT_LENGTH * 0.8) cutPoint = cut.length;
    cut = cut.slice(0, cutPoint).trimEnd();
    return cut + closeFence + suffix;
  }

  // =========================================================================
  // Formatting helpers (compact by default to reduce context usage)
  // =========================================================================

  private formatSearchResults(results: SearchResult[]): string {
    const lines: string[] = [`## Search Results (${results.length} found)`, ''];

    for (const result of results) {
      const { node } = result;
      const location = node.startLine ? `:${node.startLine}` : '';
      // Compact format: one line per result with key info
      lines.push(`### ${node.name} (${node.kind})`);
      lines.push(`${node.filePath}${location}`);
      lines.push(`key: \`${this.nodeContinuationKey(node)}\``);
      if (node.signature) lines.push(`\`${node.signature}\``);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Display label for a caller/callee node: the qualified owner
   * (`Class::method`) when it carries more than the bare name, else the bare
   * name. Without the owner an agent must guess the enclosing class and can
   * mislabel it — measured on a real django run, a `callers iri_to_uri` list
   * got 3/12 owning classes wrong (`Stylesheet.url` reported as
   * `SyndicationFeed.url`, etc.) because the bare method names (`url`,
   * `__init__`) are ambiguous across same-file classes. The owner is already
   * in the graph (`qualifiedName`); surfacing it is one short token and zero
   * extra calls.
   */
  private callerDisplayName(node: Node): string {
    return node.qualifiedName && node.qualifiedName !== node.name
      ? node.qualifiedName
      : node.name;
  }

  private formatNodeList(
    nodes: Node[],
    title: string,
    labels?: Map<string, string>,
    limit?: number,
    outputSurface: OutputSurface = 'mcp'
  ): string {
    // Slice INSIDE the formatter (not at the call site) so the header always
    // reports the TRUE total and a capped list always carries the "+N more"
    // footer. A pre-sliced list made the header lie ("20 found" when 57 exist)
    // with no re-run hint — see moreResultsNote.
    const total = nodes.length;
    const shown = limit != null && total > limit ? nodes.slice(0, limit) : nodes;
    const capped = shown.length < total;
    const header = capped
      ? `## ${title} (showing ${shown.length} of ${total})`
      : `## ${title} (${total} found)`;
    const lines: string[] = [header, ''];

    for (const node of shown) {
      const location = node.startLine ? `:${node.startLine}` : '';
      // Compact: qualified name (so the owning class is unambiguous), kind,
      // location — plus the relationship when it isn't a plain call (callback
      // registration, instantiation, …).
      const label = labels?.get(node.id);
      lines.push(
        `- ${this.callerDisplayName(node)} (${node.kind}) - ${node.filePath}${location}${label ? ` — via ${label}` : ''} — ${this.nodeContinuationLabel(node, outputSurface)}`
      );
    }

    if (capped) lines.push('', this.moreResultsNote(total, shown.length, outputSurface));

    return lines.join('\n');
  }

  /**
   * Honest "+N more" footer for a list capped at `limit`, mirroring
   * formatImpact's depth-truncation note. Without it an agent reads a capped
   * slice as the whole set and UNDER-reports the fan-in — and the high-fan-in
   * reverse query is exactly where the graph is meant to beat grep (measured:
   * vscode `checkProposedApiEnabled` has 57 distinct callers, default limit 20,
   * so the old output said "20 found" and the agent reported 20). The true
   * total is the header's job; this is the actionable re-run hint. The query
   * tools clamp `limit` to 100, so a hub with more says how to read the top 100
   * and that the rest exist.
   */
  private moreResultsNote(total: number, shown: number, outputSurface: OutputSurface = 'mcp'): string {
    const askable = Math.min(total, 100);
    const detail = total > 100
      ? `the top ${askable} (this symbol is a hub: ${total} total)`
      : 'the full list';
    const limitHint = outputSurface === 'cli' ? `--limit ${askable}` : `limit=${askable}`;
    return `> ⚠️ Showing the first ${shown} of ${total} — re-run with \`${limitHint}\` for ${detail}.`;
  }

  /**
   * Relationship label for a non-`calls` edge in callers/callees lists. A
   * function-as-value edge (#756) is the high-signal one: `callers(cb)`
   * showing "via callback registration" tells the agent this is where the
   * callback is WIRED, not where it's invoked.
   */
  private scipTrustLabels(edge: Edge): string[] {
    if (edge.provenance !== 'scip') return [];
    const labels: string[] = [];
    if (edge.metadata?.scipSourceTextVerified === false) labels.push('unverified source text');
    if (edge.metadata?.scipTargetTextVerified === false) labels.push('unverified target text');
    return labels;
  }

  private edgeLabel(edge: Edge): string | null {
    const labels: string[] = [];
    if (edge.kind !== 'calls') {
      if (edge.metadata?.fnRef === true) labels.push('callback registration');
      else if (edge.kind === 'instantiates') labels.push('instantiation');
      else if (edge.kind === 'imports') labels.push('import');
      else if (edge.kind === 'references') labels.push('reference');
      else labels.push(edge.kind);
    }
    // Heuristic call-surface edges must carry the same trust labels here as in
    // explore, so a synthesized dispatch is never rendered as a proven static call.
    const synth = this.synthEdgeNote(edge);
    if (synth) labels.push(synth.compact);
    else if (edge.provenance === 'heuristic') labels.push('heuristic');
    const confidence = edge.metadata?.confidence;
    if (typeof confidence === 'number') {
      labels.push(`confidence ${Number.isInteger(confidence) ? confidence.toFixed(0) : confidence.toFixed(2)}`);
    }
    if (edge.provenance === 'scip') labels.push('scip', ...this.scipTrustLabels(edge));
    return labels.length > 0 ? labels.join('; ') : null;
  }

  private nodeContinuationKey(node: Node): string {
    const quote = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const line = node.startLine || 1;
    return `omniweave_node symbol="${quote(node.name)}" file="${quote(node.filePath)}" line=${line}`;
  }

  private cliArg(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')}"`;
  }

  private cliNodeCommand(node: Node): string {
    const line = node.startLine || 1;
    return `omniweave node ${this.cliArg(node.name)} --file ${this.cliArg(node.filePath)} --line ${line}`;
  }

  private nodeContinuation(node: Node, outputSurface: OutputSurface): string {
    return outputSurface === 'cli' ? this.cliNodeCommand(node) : this.nodeContinuationKey(node);
  }

  private nodeContinuationLabel(node: Node, outputSurface: OutputSurface): string {
    const label = outputSurface === 'cli' ? 'cmd' : 'key';
    return `${label}: \`${this.nodeContinuation(node, outputSurface)}\``;
  }

  private formatExploreRelationshipEdge(edge: Edge, source: Node, target: Node): string {
    const notes: string[] = [];
    if (edge.line && edge.line > 0) notes.push(`${source.filePath}:${edge.line}`);

    const synthesized = this.synthEdgeNote(edge);
    if (synthesized) {
      notes.push(synthesized.compact);
    } else if (edge.provenance === 'heuristic') {
      notes.push('heuristic');
    } else if (edge.provenance === 'scip') {
      notes.push('scip', ...this.scipTrustLabels(edge));
    }

    const confidence = edge.metadata?.confidence;
    if (typeof confidence === 'number') {
      notes.push(`confidence ${Number.isInteger(confidence) ? confidence.toFixed(0) : confidence.toFixed(2)}`);
    }

    const suffix = notes.length > 0 ? `   [${notes.join('; ')}]` : '';
    return `- ${source.name} → ${target.name}${suffix}`;
  }

  private formatImpact(symbol: string, impact: Subgraph, depth?: number): string {
    const nodeCount = impact.nodes.size;
    const scipEdges = impact.edges.filter((edge) => edge.provenance === 'scip');
    const directlyScipReached = new Set(scipEdges.map((edge) => edge.source));

    // Compact format: just list affected symbols grouped by file
    const lines: string[] = [
      `## Impact: "${symbol}" affects ${nodeCount} symbols`,
      '',
    ];

    if (scipEdges.length > 0) {
      const labels = new Set<string>();
      for (const edge of scipEdges) {
        for (const label of this.scipTrustLabels(edge)) labels.add(label);
      }
      const suffix = labels.size > 0 ? ` (${[...labels].join('; ')})` : '';
      lines.push(
        `> SCIP provenance: ${scipEdges.length} traversed relationship(s) came from index.scip${suffix}; verify those affected symbols with source before editing.`,
        ''
      );
    }

    // Group by file
    const byFile = new Map<string, Node[]>();
    for (const node of impact.nodes.values()) {
      const existing = byFile.get(node.filePath) || [];
      existing.push(node);
      byFile.set(node.filePath, existing);
    }

    for (const [file, nodes] of byFile) {
      lines.push(`**${file}:**`);
      // Compact: inline list
      const nodeList = nodes.map(n => `${n.name}:${n.startLine}${directlyScipReached.has(n.id) ? ' [scip]' : ''}`).join(', ');
      lines.push(nodeList);
      lines.push('');
    }

    // Honest incompleteness: this set is a depth-clipped prefix of the true
    // transitive closure, so say so and how to get the rest — otherwise an
    // agent reads N symbols as "the whole blast radius" and stops short.
    if (impact.truncated) {
      const atDepth = depth ?? 2;
      const more = impact.deeperCount && impact.deeperCount > 0
        ? `at least ${impact.deeperCount} more dependent symbol(s) exist`
        : 'more dependents exist';
      lines.push(
        `> ⚠️ Partial — traversal stopped at depth ${atDepth}; ${more} deeper. ` +
        `Re-run \`omniweave_impact\` with a higher \`depth\` (e.g. depth=${atDepth + 2}) for the full transitive closure.`
      );
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Build a compact structural outline of a container symbol from its
   * indexed children (methods, fields, properties, …) — name, kind,
   * line number, and signature — so the agent gets the shape of a class
   * without the full source of every method. Returns '' when the container
   * has no indexed children, so the caller can fall back to full source.
   */
  private buildContainerOutline(cg: OmniWeave, node: Node): string {
    const children = cg.getChildren(node.id)
      .filter(c => c.kind !== 'import' && c.kind !== 'export')
      .sort((a, b) => (a.startLine ?? 0) - (b.startLine ?? 0));
    if (children.length === 0) return '';

    const lines = [`**Members (${children.length}):**`, ''];
    for (const c of children) {
      const loc = c.startLine ? `:${c.startLine}` : '';
      const sig = c.signature ? ` — \`${c.signature}\`` : '';
      lines.push(`- ${c.name} (${c.kind})${loc}${sig}`);
    }
    return lines.join('\n');
  }

  private formatNodeDetails(
    node: Node,
    code: string | null,
    outline?: string | null,
    outputSurface: OutputSurface = 'mcp',
    trail = '',
  ): string {
    const location = node.startLine ? `:${node.startLine}` : '';
    const continuation = this.nodeContinuation(node, outputSurface);
    const continuationLabel = outputSurface === 'cli' ? 'Command' : 'Key';
    const lines: string[] = [
      `## ${node.name} (${node.kind})`,
      '',
      `**Location:** ${node.filePath}${location}`,
      `**${continuationLabel}:** \`${continuation}\``,
    ];

    if (node.signature) {
      lines.push(`**Signature:** \`${node.signature}\``);
    }

    // Only include docstring if it's short and useful
    if (node.docstring && node.docstring.length < 200) {
      lines.push('', node.docstring);
    }

    if (trail) {
      lines.push('', trail.trimStart());
    }

    if (outline) {
      const memberRetry = outputSurface === 'cli'
        ? `run \`omniweave node <member> --file ${this.cliArg(node.filePath)}\``
        : 'call omniweave_node on a specific member';
      lines.push('', outline, '',
        `> Structural outline only. Read \`${node.filePath}\` or ${memberRetry} for its body.`);
    } else if (code) {
      // Line-numbered (cat -n style, like omniweave_explore and Read) so the
      // agent can cite/edit exact lines without re-Reading the file for them.
      const numbered = node.startLine ? numberSourceLines(code, node.startLine) : code;
      lines.push('', '```' + node.language, numbered, '```');
    }

    return lines.join('\n');
  }

  private textResult(text: string): ToolResult {
    return {
      content: [{ type: 'text', text }],
    };
  }

  private buildNoExploreResultsMessage(
    query: string,
    fileCount: number | null = null,
    outputSurface: OutputSurface = 'mcp'
  ): string {
    if (fileCount === 0) {
      const refreshStep = outputSurface === 'cli'
        ? '- Run `omniweave sync` after source files are present.'
        : '- Refresh the index after source files are present.';

      return [
        `No relevant code found for "${query}".`,
        '',
        'The OmniWeave index is initialized but contains 0 files.',
        '',
        'This is an empty index state, not a tool failure.',
        '',
        'Next best steps:',
        '- Continue with normal file tools for this task; there is no graph content to query yet.',
        '- If source files exist, confirm they are supported and not excluded by project config.',
        refreshStep,
      ].join('\n');
    }

    const nextSteps = outputSurface === 'cli'
      ? [
        '- Check the exact symbol or file name with `omniweave query <name>`.',
        '- If you already know the file path, use `omniweave node <path>` to read it with line numbers.',
        '- If this was a prose query, retry `omniweave explore "<identifier1 identifier2 ...>"` with 2-5 concrete identifiers from the error, stack trace, or surrounding code.',
        '- If the file was just created, renamed, or generated, run `omniweave sync` before querying it.',
      ]
      : [
        '- Check the exact symbol or file name with `omniweave_search <name>`.',
        '- If you already know the file path, use `omniweave_node <path>` to read it with line numbers.',
        '- If this was a prose query, retry `omniweave_explore` with 2-5 concrete identifiers from the error, stack trace, or surrounding code.',
        '- If the file was just created or renamed, give the file watcher a moment to index it, then re-run `omniweave_explore`.',
      ];

    return [
      `No relevant code found for "${query}".`,
      '',
      'This is an empty retrieval result, not a tool failure.',
      '',
      'Next best steps:',
      ...nextSteps,
    ].join('\n');
  }

  private buildAmbiguousExploreSection(items: AmbiguousExploreToken[], outputSurface: OutputSurface = 'mcp'): string {
    if (items.length === 0) return '';
    const formatNode = (n: Node): string => {
      const continuation = outputSurface === 'cli'
        ? `cmd: \`${this.nodeContinuation(n, outputSurface)}\``
        : `key: \`${this.nodeContinuation(n, outputSurface)}\``;
      return `\`${n.qualifiedName || n.name}\` (${n.filePath}:${n.startLine}; ${continuation})`;
    };
    const lines = [
      '### Ambiguous named symbols',
      '',
      '> One or more bare query terms matched many callable definitions. `explore` kept a small ranked subset below; do not treat that subset as the full overload set.',
      '',
    ];
    for (const item of items.slice(0, 4)) {
      lines.push(
        `- \`${item.token}\` matched ${item.total} callable definitions; kept ${item.selected.map(formatNode).join(', ')}.`
      );
      if (item.alternatives.length > 0) {
        lines.push(`  Other candidates include: ${item.alternatives.map(formatNode).join(', ')}.`);
      }
    }
    if (items.length > 4) {
      lines.push(`- ... and ${items.length - 4} more ambiguous query term${items.length - 4 === 1 ? '' : 's'}.`);
    }
    lines.push(
      '',
      outputSurface === 'cli'
        ? '> Add an owning class, namespace, or file path and rerun `omniweave explore "<query>"`, or run the printed `omniweave node ... --file ... --line ...` command to pin one definition.'
        : '> Add an owning class, namespace, or file path and rerun `omniweave_explore`, or call `omniweave_node` with `symbol` + `file` to pin one definition.',
      ''
    );
    return lines.join('\n');
  }

  private errorResult(message: string): ToolResult {
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
}
