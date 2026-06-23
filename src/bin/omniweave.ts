#!/usr/bin/env node
/**
 * OmniWeave CLI
 *
 * Command-line interface for OmniWeave code intelligence.
 *
 * Usage:
 *   omniweave                    Run interactive installer (when no args)
 *   omniweave install            Run interactive installer
 *   omniweave uninstall          Remove OmniWeave from your agents
 *   omniweave init [path]        Initialize OmniWeave in a project
 *   omniweave uninit [path]      Remove OmniWeave from a project
 *   omniweave index [path]       Index all files in the project
 *   omniweave sync [path]        Sync changes since last index
 *   omniweave status [path]      Show index status
 *   omniweave query <search>     Search for symbols
 *   omniweave files [options]    Show project file structure
 *   omniweave context <task>     Build context for a task
 *   omniweave callers <symbol>   Find what calls a function/method
 *   omniweave callees <symbol>   Find what a function/method calls
 *   omniweave impact <symbol>    Analyze what code is affected by changing a symbol
 *   omniweave affected [files]   Find test files affected by changes
 *   omniweave snapshot           Export, verify, or import graph artifacts
 *   omniweave scip import        Import optional SCIP facts from index.scip
 *   omniweave upgrade [version]  Update OmniWeave to the latest release
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { getOmniWeaveDir, isInitialized, unsafeIndexRootReason } from '../directory';
import { detectWorktreeIndexMismatch, worktreeMismatchWarning } from '../sync/worktree';
import { createShimmerProgress } from '../ui/shimmer-progress';
import { getGlyphs } from '../ui/glyphs';
import type { EdgeKind, Node } from '../types';
import { isLowSignalSourceFile } from '../search/query-utils';
import { clamp } from '../utils';

import { buildNode25BlockBanner, buildNodeTooOldBanner, isNodeTooOld } from './node-version-check';
import { relaunchWithWasmRuntimeFlagsIfNeeded } from '../extraction/wasm-runtime-flags';
import { EXTRACTION_VERSION } from '../extraction/extraction-version';
import { getTelemetry, TELEMETRY_DOCS, recordIndexEvent } from '../telemetry';
import { describeSnapshotImportWarning } from '../snapshot-metadata';

// Lazy-load heavy modules (OmniWeave, runInstaller) to keep CLI startup fast.
async function loadOmniWeave(): Promise<typeof import('../index')> {
  try {
    return await import('../index');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\x1b[31m${getGlyphs().err}\x1b[0m Failed to load OmniWeave modules.`);
    console.error(`\n  Node: ${process.version}  Platform: ${process.platform} ${process.arch}`);
    console.error(`\n  Error: ${msg}`);
    console.error('\n  Try reinstalling with: npm install -g @solvinglab/omniweave\n');
    process.exit(1);
  }
}

function cliArg(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')}"`;
}

function nodeContinuationCommand(node: Node): string {
  const line = node.startLine || 1;
  return `omniweave node ${cliArg(node.name)} --file ${cliArg(node.filePath)} --line ${line}`;
}

function parseCliIntOption(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return clamp(parsed, min, max);
}

const CLI_CALL_SURFACE_EDGE_KINDS = new Set<EdgeKind>(['calls', 'crossLang', 'invokes', 'instantiates']);

interface CliRelationshipNode {
  name: string;
  kind: string;
  filePath: string;
  startLine?: number;
}

interface CliCallSurfaceResult {
  nodes: CliRelationshipNode[];
  omittedLowSignal: number;
  omittedWeak: number;
}

function exactCliSymbolMatch(node: Node, symbol: string): boolean {
  return node.name === symbol || node.name.endsWith(`.${symbol}`) || node.name.endsWith(`::${symbol}`);
}

function cliFileMatches(node: Node, fileFilter: string): boolean {
  const wanted = fileFilter.replace(/\\/g, '/').replace(/^\.\//, '');
  const filePath = node.filePath.replace(/\\/g, '/');
  return filePath === wanted || filePath.endsWith(wanted) || filePath.endsWith(`/${wanted}`);
}

function narrowCliSymbolMatches(
  matches: Array<{ node: Node }>,
  symbol: string,
  fileFilter?: string
): { matches: Array<{ node: Node }>; filteredOut: boolean } {
  const exactMatches = matches.filter((match) => exactCliSymbolMatch(match.node, symbol));
  const exactPool = exactMatches.length > 0 ? exactMatches : matches.slice(0, 1);
  const hasFirstPartyExact = exactPool.some((match) => !isLowSignalSourceFile(match.node.filePath));
  const firstPartyPool = hasFirstPartyExact
    ? exactPool.filter((match) => !isLowSignalSourceFile(match.node.filePath))
    : exactPool;

  if (!fileFilter) return { matches: firstPartyPool, filteredOut: false };
  const narrowed = firstPartyPool.filter((match) => cliFileMatches(match.node, fileFilter));
  return narrowed.length > 0
    ? { matches: narrowed, filteredOut: false }
    : { matches: firstPartyPool, filteredOut: true };
}

function cliRelationshipOmissionNote(omittedLowSignal: number, omittedWeak: number): string[] {
  const lines: string[] = [];
  if (omittedLowSignal > 0) {
    lines.push(`Omitted ${omittedLowSignal} low-signal relationship${omittedLowSignal === 1 ? '' : 's'} from test/example/research snapshot sources; inspect those paths explicitly if that support corpus is the target.`);
  }
  if (omittedWeak > 0) {
    lines.push(`Omitted ${omittedWeak} non-execution reference/type/import relationship${omittedWeak === 1 ? '' : 's'}; use impact/explore when dependency closure matters.`);
  }
  return lines;
}

function collectCliCallSurface(
  matches: Array<{ node: Node }>,
  symbol: string,
  fileFilter: string | undefined,
  getRelationships: (nodeId: string) => Array<{ node: Node; edge: { kind: EdgeKind } }>
): CliCallSurfaceResult & { filteredOut: boolean } {
  const narrowed = narrowCliSymbolMatches(matches, symbol, fileFilter);
  const seen = new Set<string>();
  const nodes: CliRelationshipNode[] = [];
  let omittedLowSignal = 0;
  let omittedWeak = 0;

  for (const match of narrowed.matches) {
    const definitionIsLowSignal = isLowSignalSourceFile(match.node.filePath);
    for (const relationship of getRelationships(match.node.id)) {
      if (!CLI_CALL_SURFACE_EDGE_KINDS.has(relationship.edge.kind)) {
        omittedWeak++;
        continue;
      }
      if (!definitionIsLowSignal && isLowSignalSourceFile(relationship.node.filePath)) {
        omittedLowSignal++;
        continue;
      }
      if (seen.has(relationship.node.id)) continue;
      seen.add(relationship.node.id);
      nodes.push({
        name: relationship.node.name,
        kind: relationship.node.kind,
        filePath: relationship.node.filePath,
        startLine: relationship.node.startLine,
      });
    }
  }

  return { nodes, omittedLowSignal, omittedWeak, filteredOut: narrowed.filteredOut };
}

// Dynamic import helper — tsc compiles import() to require() in CJS mode,
// which fails for ESM-only packages. This bypasses the transformation.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importESM = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<typeof import('@clack/prompts')>;

// Block OmniWeave on Node.js 25.x — V8's turboshaft WASM JIT has a Zone
// allocator bug that reliably crashes when compiling tree-sitter
// grammars (see #54, #81, #140). The previous behaviour was a soft
// console.warn that scrolls off-screen before the OOM crash 30 seconds
// later, leading to a steady stream of "what is this OOM" reports.
// Hard-exit before any WASM work; allow override via env var for users
// who patched V8 themselves or want to test a future fix.
const nodeVersion = process.versions.node;
const nodeMajor = parseInt(nodeVersion.split('.')[0] ?? '0', 10);
if (nodeMajor >= 25) {
  process.stderr.write(buildNode25BlockBanner(nodeVersion) + '\n');
  if (!process.env.OMNIWEAVE_ALLOW_UNSAFE_NODE) {
    process.exit(1);
  }
  // Override active — banner shown for visibility, continuing.
}
// Enforce the supported Node floor. `engines` in package.json only *warns* on
// install (unless engine-strict), so hard-block here to actually keep users off
// unsupported versions. Mirrors the 25+ block above. See package.json `engines`.
if (isNodeTooOld(nodeVersion)) {
  process.stderr.write(buildNodeTooOldBanner(nodeVersion) + '\n');
  if (!process.env.OMNIWEAVE_ALLOW_UNSAFE_NODE) {
    process.exit(1);
  }
  // Override active — banner shown for visibility, continuing.
}

// Re-exec with V8's `--liftoff-only` if it isn't already set, so tree-sitter's
// large WASM grammars never hit the turboshaft Zone OOM (`Fatal process out of
// memory: Zone`) on Node >= 22. No-op under the bundled launcher, which already
// passes the flag. Must run before any grammar (in the parse worker, which
// inherits this process's flags) is compiled. See ../extraction/wasm-runtime-flags.
relaunchWithWasmRuntimeFlagsIfNeeded(__filename);

// Check if running with no arguments - run installer
if (process.argv.length === 2) {
  import('../installer').then(({ runInstaller }) =>
    runInstaller()
  ).catch((err) => {
    console.error('Installation failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
} else {
  // Normal CLI flow
  main();
}

process.on('uncaughtException', (error) => {
  console.error('[OmniWeave] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[OmniWeave] Unhandled rejection:', reason);
});

function main() {

const program = new Command();

// Version from package.json
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8')
);

// =============================================================================
// ANSI Color Helpers (avoid chalk ESM issues)
// =============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

const chalk = {
  bold: (s: string) => `${colors.bold}${s}${colors.reset}`,
  dim: (s: string) => `${colors.dim}${s}${colors.reset}`,
  red: (s: string) => `${colors.red}${s}${colors.reset}`,
  green: (s: string) => `${colors.green}${s}${colors.reset}`,
  yellow: (s: string) => `${colors.yellow}${s}${colors.reset}`,
  blue: (s: string) => `${colors.blue}${s}${colors.reset}`,
  cyan: (s: string) => `${colors.cyan}${s}${colors.reset}`,
  white: (s: string) => `${colors.white}${s}${colors.reset}`,
  gray: (s: string) => `${colors.gray}${s}${colors.reset}`,
};

program
  .name('omniweave')
  .description('Code intelligence and knowledge graph for any codebase')
  .version(packageJson.version);

// Anonymous usage telemetry (see TELEMETRY.md): record the invoked subcommand
// NAME only — never arguments or paths. Counts buffer locally; network sends
// piggyback on commands that run long anyway (quick commands only append to
// the local buffer at exit, costing nothing).
// install/uninstall are absent on purpose: the installer flushes at its own
// end, AFTER its consent prompt — a flush here would fire the first-run
// notice before the user ever sees the toggle.
const TELEMETRY_FLUSH_COMMANDS = new Set(['init', 'uninit', 'index', 'sync', 'upgrade']);
program.hook('preAction', (_thisCommand, actionCommand) => {
  try {
    // The detached daemon re-invokes `serve --mcp` internally — not a user action.
    if (process.env.OMNIWEAVE_DAEMON_INTERNAL) return;
    const name = actionCommand.name();
    if (name === 'telemetry') return; // managing telemetry is not usage
    getTelemetry().recordUsage('cli_command', name, true);
    if (TELEMETRY_FLUSH_COMMANDS.has(name)) getTelemetry().maybeFlush();
  } catch {
    /* telemetry must never break the CLI */
  }
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Resolve project path from argument or current directory
 * Walks up parent directories to find nearest initialized OmniWeave project
 * (must have .omniweave/omniweave.db, not just .omniweave/lessons.db)
 */
function resolveProjectPath(pathArg?: string): string {
  const absolutePath = path.resolve(pathArg || process.cwd());

  // If exact path is initialized (has omniweave.db), use it
  if (isInitialized(absolutePath)) {
    return absolutePath;
  }

  // Walk up to find nearest parent with OmniWeave initialized
  // Note: findNearestOmniWeaveRoot finds any .omniweave folder, but we need one with omniweave.db
  let current = absolutePath;
  const root = path.parse(current).root;

  while (current !== root) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;

    if (isInitialized(current)) {
      return current;
    }
  }

  // Not found - return original path (will fail later with helpful error)
  return absolutePath;
}

/**
 * Format a number with commas
 */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Format duration in milliseconds to human readable
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
}

// Shimmer progress renderer (runs in a worker thread for smooth animation)
// Imported at top of file from '../ui/shimmer-progress'

/**
 * Create a plain-text progress callback for --verbose mode.
 * No animations, no ANSI tricks — just timestamped lines to stdout.
 */
function createVerboseProgress(): (progress: { phase: string; current: number; total: number; currentFile?: string }) => void {
  let lastPhase = '';
  let lastPct = -1;
  const startTime = Date.now();

  return (progress) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (progress.phase !== lastPhase) {
      lastPhase = progress.phase;
      lastPct = -1;
      console.log(`[${elapsed}s] Phase: ${progress.phase}`);
    }

    if (progress.total > 0) {
      const pct = Math.floor((progress.current / progress.total) * 100);
      // Log every 5% to keep output manageable
      if (pct >= lastPct + 5 || progress.current === progress.total) {
        lastPct = pct;
        console.log(`[${elapsed}s]   ${progress.current}/${progress.total} (${pct}%)${progress.currentFile ? ` ${getGlyphs().dash} ${progress.currentFile}` : ''}`);
      }
    } else if (progress.current > 0) {
      // Scanning phase (no total yet) — log periodically
      if (progress.current % 1000 === 0 || progress.current === 1) {
        console.log(`[${elapsed}s]   ${formatNumber(progress.current)} files found`);
      }
    }
  };
}

/**
 * Print success message
 */
function success(message: string): void {
  console.log(chalk.green(getGlyphs().ok) + ' ' + message);
}

/**
 * Print error message
 */
function error(message: string): void {
  console.error(chalk.red(getGlyphs().err) + ' ' + message);
}

/**
 * Print info message
 */
function info(message: string): void {
  console.log(chalk.blue(getGlyphs().info) + ' ' + message);
}

/**
 * Print warning message
 */
function warn(message: string): void {
  console.log(chalk.yellow(getGlyphs().warn) + ' ' + message);
}

function buildExploreUnavailableMessage(projectPath: string): string {
  return [
    `OmniWeave isn't available here — no .omniweave/ index exists in ${projectPath}.`,
    '',
    'This is not a tool failure. If you are an AI agent, continue with your usual tools for this task; indexing is the user/project owner\'s decision, do not run it yourself.',
    '',
    `The project owner can enable OmniWeave later with: omniweave init "${projectPath}"`,
  ].join('\n');
}

type IndexResult = {
  success: boolean;
  filesIndexed: number;
  filesSkipped: number;
  filesErrored: number;
  nodesCreated: number;
  edgesCreated: number;
  errors: Array<{ message: string; filePath?: string; severity: string; code?: string }>;
  durationMs: number;
};

/**
 * Print indexing results using clack log methods
 */
function printIndexResult(clack: typeof import('@clack/prompts'), result: IndexResult, projectPath?: string): void {
  const hasErrors = result.filesErrored > 0;

  // Surface non-file-level failures (e.g. lock-acquisition failure
  // when another indexer is running) before the file-count branches.
  // Without this the CLI falls through to "No files found to index",
  // which is actively misleading — the index DID run, it just couldn't
  // get the lock.
  //
  // If success is false but no severity:'error' entry exists in
  // `result.errors` (degenerate case — shouldn't happen in practice
  // but worth guarding because the result shape is plumbed through
  // multiple call sites), fall back to a generic message rather than
  // continuing to the misleading "No files found" branch or throwing.
  if (!result.success && !hasErrors && result.filesIndexed === 0) {
    const generic = result.errors.find((e) => e.severity === 'error');
    clack.log.error(generic?.message ?? `Indexing failed ${getGlyphs().dash} no further details available`);
    return;
  }

  if (result.filesIndexed > 0) {
    if (hasErrors) {
      clack.log.success(`Indexed ${formatNumber(result.filesIndexed)} files (${formatNumber(result.filesErrored)} could not be parsed)`);
    } else {
      clack.log.success(`Indexed ${formatNumber(result.filesIndexed)} files`);
    }
    clack.log.info(`${formatNumber(result.nodesCreated)} nodes, ${formatNumber(result.edgesCreated)} edges in ${formatDuration(result.durationMs)}`);
  } else if (hasErrors) {
    clack.log.error(`Indexing failed ${getGlyphs().dash} all ${formatNumber(result.filesErrored)} files had errors`);
  } else {
    clack.log.warn('No files found to index');
  }

  if (hasErrors) {
    const errorsByCode = new Map<string, number>();
    for (const err of result.errors) {
      if (err.severity === 'error') {
        const code = err.code || 'unknown';
        errorsByCode.set(code, (errorsByCode.get(code) || 0) + 1);
      }
    }

    const codeLabels: Record<string, string> = {
      parse_error: 'files failed to parse',
      read_error: 'files could not be read',
      size_exceeded: 'files exceeded size limit',
      path_traversal: 'blocked paths',
      unsupported_language: 'unsupported language',
      parser_error: 'parser initialization failures',
    };

    const breakdown = Array.from(errorsByCode)
      .map(([code, count]) => `${formatNumber(count)} ${codeLabels[code] || code}`)
      .join('\n');
    clack.note(breakdown, 'Error breakdown');

    if (projectPath) {
      writeErrorLog(projectPath, result.errors);
      clack.log.info('See .omniweave/errors.log for details');
    }

    if (result.filesIndexed > 0) {
      clack.log.info(`The index is fully usable ${getGlyphs().dash} only the failed files are missing.`);
    }
  } else if (projectPath) {
    const logPath = path.join(getOmniWeaveDir(projectPath), 'errors.log');
    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
    }
  }
}

/**
 * Write detailed error log to .omniweave/errors.log
 */
function writeErrorLog(projectPath: string, errors: Array<{ message: string; filePath?: string; severity: string; code?: string }>): void {
  const cgDir = getOmniWeaveDir(projectPath);
  if (!fs.existsSync(cgDir)) return;

  const logPath = path.join(cgDir, 'errors.log');

  // Group errors by file path
  const errorsByFile = new Map<string, Array<{ message: string; code?: string }>>();
  const noFileErrors: Array<{ message: string; code?: string }> = [];

  for (const err of errors) {
    if (err.severity !== 'error') continue;
    if (err.filePath) {
      let list = errorsByFile.get(err.filePath);
      if (!list) {
        list = [];
        errorsByFile.set(err.filePath, list);
      }
      list.push({ message: err.message, code: err.code });
    } else {
      noFileErrors.push({ message: err.message, code: err.code });
    }
  }

  const lines: string[] = [
    `OmniWeave Error Log - ${new Date().toISOString()}`,
    `${errorsByFile.size} files with errors`,
    '',
  ];

  for (const [filePath, fileErrors] of errorsByFile) {
    for (const err of fileErrors) {
      lines.push(`${filePath}: ${err.message}`);
    }
  }

  for (const err of noFileErrors) {
    lines.push(err.message);
  }

  fs.writeFileSync(logPath, lines.join('\n') + '\n');
}

/**
 * Telemetry for a completed full index (see TELEMETRY.md). The bounded flush
 * keeps init/index responsive (these commands just ran for seconds anyway)
 * while delivering the event promptly.
 */
async function recordIndexTelemetry(
  cg: { getStats(): { filesByLanguage: Record<string, number> }; getBackend(): string },
  result: IndexResult,
): Promise<void> {
  recordIndexEvent(cg, result);
  await getTelemetry().flushNow();
}

// =============================================================================
// Commands
// =============================================================================

/**
 * omniweave init [path]
 */
program
  .command('init [path]')
  .description('Initialize OmniWeave in a project directory and build the initial index')
  .option('-i, --index', 'Deprecated: indexing now runs by default; flag accepted for backward compatibility')
  .option('-f, --force', 'Initialize even if the path looks like your home directory or a filesystem root')
  .option('-v, --verbose', 'Show detailed worker lifecycle and memory info')
  .action(async (pathArg: string | undefined, options: { index?: boolean; force?: boolean; verbose?: boolean }) => {
    const projectPath = path.resolve(pathArg || process.cwd());
    const clack = await importESM('@clack/prompts');

    clack.intro('Initializing OmniWeave');

    try {
      const unsafe = unsafeIndexRootReason(projectPath);
      if (unsafe && !options.force) {
        clack.log.error(`Refusing to initialize in ${projectPath} — it looks like ${unsafe}.`);
        clack.log.info('Run this inside a specific project directory, or pass --force if you really mean to index everything under it.');
        clack.outro('');
        process.exitCode = 1;
        return;
      }

      if (isInitialized(projectPath)) {
        clack.log.warn(`Already initialized in ${projectPath}`);
        clack.log.info('Use "omniweave index" to re-index or "omniweave sync" to update');
        try {
          const { offerWatchFallback } = await import('../installer');
          await offerWatchFallback(clack, projectPath);
        } catch { /* non-fatal */ }
        clack.outro('');
        return;
      }

      const { default: OmniWeave } = await loadOmniWeave();
      const cg = await OmniWeave.init(projectPath, { index: false });
      clack.log.success(`Initialized in ${projectPath}`);

      // Indexing runs by default now. The legacy -i/--index flag is still
      // accepted (so existing muscle memory and scripts don't break) but is a
      // no-op — initializing always builds the initial index.
      let result: IndexResult;
      if (options.verbose) {
        result = await cg.indexAll({
          onProgress: createVerboseProgress(),
          verbose: true,
        });
      } else {
        process.stdout.write(`${colors.dim}${getGlyphs().rail}${colors.reset}\n`);
        const progress = createShimmerProgress();
        result = await cg.indexAll({
          onProgress: progress.onProgress,
        });
        await progress.stop();
      }
      printIndexResult(clack, result, projectPath);
      await recordIndexTelemetry(cg, result);

      try {
        const { offerWatchFallback } = await import('../installer');
        await offerWatchFallback(clack, projectPath);
      } catch { /* non-fatal */ }

      clack.outro('Done');
      cg.destroy();
    } catch (err) {
      clack.log.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * omniweave uninit [path]
 */
program
  .command('uninit [path]')
  .description('Remove OmniWeave from a project (deletes .omniweave/ directory)')
  .option('-f, --force', 'Skip confirmation prompt')
  .action(async (pathArg: string | undefined, options: { force?: boolean }) => {
    const projectPath = resolveProjectPath(pathArg);

    try {
      if (!isInitialized(projectPath)) {
        warn(`OmniWeave is not initialized in ${projectPath}`);
        return;
      }

      if (!options.force) {
        // Confirm with user
        const readline = await import('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(
            chalk.yellow(`${getGlyphs().warn} This will permanently delete all OmniWeave data. Continue? (y/N) `),
            resolve
          );
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          info('Cancelled');
          return;
        }
      }

      const { default: OmniWeave } = await loadOmniWeave();
      const cg = OmniWeave.openSync(projectPath);
      cg.uninitialize();

      // Clean up any git sync hooks we installed (no-op if none / not a repo).
      try {
        const { removeGitSyncHook } = await import('../sync/git-hooks');
        const removed = removeGitSyncHook(projectPath);
        if (removed.installed.length > 0) {
          info(`Removed git ${removed.installed.join(', ')} sync hook${removed.installed.length > 1 ? 's' : ''}`);
        }
      } catch { /* non-fatal */ }

      success(`Removed OmniWeave from ${projectPath}`);

      // Churn signal — and flush now, since after an uninit there may be no
      // "next run" to deliver it.
      try {
        getTelemetry().recordLifecycle('uninstall', {});
        await getTelemetry().flushNow();
      } catch { /* non-fatal */ }
    } catch (err) {
      error(`Failed to uninitialize: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * omniweave index [path]
 */
program
  .command('index [path]')
  .description('Index all files in the project')
  .option('-f, --force', 'Force full re-index even if already indexed')
  .option('-q, --quiet', 'Suppress progress output')
  .option('-v, --verbose', 'Show detailed worker lifecycle and memory info')
  .action(async (pathArg: string | undefined, options: { force?: boolean; quiet?: boolean; verbose?: boolean }) => {
    const projectPath = resolveProjectPath(pathArg);

    try {
      const unsafe = unsafeIndexRootReason(projectPath);
      if (unsafe && !options.force) {
        error(`Refusing to index ${projectPath} — it looks like ${unsafe}. Pass --force to override.`);
        process.exit(1);
      }

      if (!isInitialized(projectPath)) {
        error(`OmniWeave not initialized in ${projectPath}`);
        info('Run "omniweave init" first');
        process.exit(1);
      }

      const { default: OmniWeave } = await loadOmniWeave();
      const cg = await OmniWeave.open(projectPath);

      if (options.quiet) {
        // Quiet mode: no UI, just run
        if (options.force) cg.clear();
        const result = await cg.indexAll();
        if (!result.success) process.exit(1);
        cg.destroy();
        return;
      }

      const clack = await importESM('@clack/prompts');
      clack.intro('Indexing project');

      if (options.force) {
        cg.clear();
        clack.log.info('Cleared existing index');
      }

      let result: IndexResult;

      if (options.verbose) {
        result = await cg.indexAll({
          onProgress: createVerboseProgress(),
          verbose: true,
        });
      } else {
        process.stdout.write(`${colors.dim}${getGlyphs().rail}${colors.reset}\n`);
        const progress = createShimmerProgress();
        result = await cg.indexAll({
          onProgress: progress.onProgress,
        });
        await progress.stop();
      }

      printIndexResult(clack, result, projectPath);
      await recordIndexTelemetry(cg, result);

      if (!result.success) {
        process.exit(1);
      }

      clack.outro('Done');
      cg.destroy();
    } catch (err) {
      error(`Failed to index: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * omniweave sync [path]
 */
program
  .command('sync [path]')
  .description('Sync changes since last index')
  .option('-q, --quiet', 'Suppress output (for git hooks)')
  .action(async (pathArg: string | undefined, options: { quiet?: boolean }) => {
    const projectPath = resolveProjectPath(pathArg);

    try {
      if (!isInitialized(projectPath)) {
        if (!options.quiet) {
          error(`OmniWeave not initialized in ${projectPath}`);
        }
        process.exit(1);
      }

      const { default: OmniWeave } = await loadOmniWeave();
      const cg = await OmniWeave.open(projectPath);

      if (options.quiet) {
        await cg.sync();
        cg.destroy();
        return;
      }

      const clack = await importESM('@clack/prompts');
      clack.intro('Syncing OmniWeave');

      process.stdout.write(`${colors.dim}${getGlyphs().rail}${colors.reset}\n`);
      const progress = createShimmerProgress();

      const result = await cg.sync({
        onProgress: progress.onProgress,
      });

      await progress.stop();

      const totalChanges = result.filesAdded + result.filesModified + result.filesRemoved;

      if (totalChanges === 0) {
        clack.log.info('Already up to date');
      } else {
        clack.log.success(`Synced ${formatNumber(totalChanges)} changed files`);
        const details: string[] = [];
        if (result.filesAdded > 0) details.push(`Added: ${result.filesAdded}`);
        if (result.filesModified > 0) details.push(`Modified: ${result.filesModified}`);
        if (result.filesRemoved > 0) details.push(`Removed: ${result.filesRemoved}`);
        clack.log.info(`${details.join(', ')} ${getGlyphs().dash} ${formatNumber(result.nodesUpdated)} nodes in ${formatDuration(result.durationMs)}`);
      }

      clack.outro('Done');
      cg.destroy();
    } catch (err) {
      if (!options.quiet) {
        error(`Failed to sync: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
  });

/**
 * omniweave status [path]
 */
program
  .command('status [path]')
  .description('Show index status and statistics')
  .option('-j, --json', 'Output as JSON')
  .action(async (pathArg: string | undefined, options: { json?: boolean }) => {
    const projectPath = resolveProjectPath(pathArg);
    // The directory the user actually ran from, before walking up to the index
    // root. Used to detect when the resolved index lives in a different git
    // working tree (e.g. a nested worktree borrowing the main checkout's index).
    const startPath = path.resolve(pathArg || process.cwd());
    const worktreeMismatch = detectWorktreeIndexMismatch(startPath, projectPath);

    try {
      if (!isInitialized(projectPath)) {
        if (options.json) {
          console.log(JSON.stringify({
            initialized: false,
            version: packageJson.version,
            projectPath,
            indexPath: getOmniWeaveDir(projectPath),
            lastIndexed: null,
          }));
          return;
        }
        console.log(chalk.bold('\nOmniWeave Status\n'));
        info(`Project: ${projectPath}`);
        warn('Not initialized');
        info('Run "omniweave init" to initialize');
        return;
      }

      const { default: OmniWeave } = await loadOmniWeave();
      const cg = await OmniWeave.open(projectPath);
      const stats = cg.getStats();
      const changes = cg.getChangedFiles();
      const backend = cg.getBackend();
      const journalMode = cg.getJournalMode();

      const buildInfo = cg.getIndexBuildInfo();
      const reindexRecommended = cg.isIndexStale();
      const snapshotImport = cg.getSnapshotImportInfo();

      // JSON output mode
      if (options.json) {
        const lastIndexedMs = cg.getLastIndexedAt();
        console.log(JSON.stringify({
          initialized: true,
          version: packageJson.version,
          projectPath,
          indexPath: getOmniWeaveDir(projectPath),
          lastIndexed: lastIndexedMs != null ? new Date(lastIndexedMs).toISOString() : null,
          fileCount: stats.fileCount,
          nodeCount: stats.nodeCount,
          edgeCount: stats.edgeCount,
          dbSizeBytes: stats.dbSizeBytes,
          backend,
          journalMode,
          nodesByKind: stats.nodesByKind,
          languages: Object.entries(stats.filesByLanguage).filter(([, count]) => count > 0).map(([lang]) => lang),
          pendingChanges: {
            added: changes.added.length,
            modified: changes.modified.length,
            removed: changes.removed.length,
          },
          worktreeMismatch: worktreeMismatch
            ? { worktreeRoot: worktreeMismatch.worktreeRoot, indexRoot: worktreeMismatch.indexRoot }
            : null,
          index: {
            builtWithVersion: buildInfo.version,
            builtWithExtractionVersion: buildInfo.extractionVersion,
            currentExtractionVersion: EXTRACTION_VERSION,
            reindexRecommended,
          },
          snapshotImport,
        }));
        cg.destroy();
        return;
      }

      console.log(chalk.bold('\nOmniWeave Status\n'));

      // Project info
      console.log(chalk.cyan('Project:'), projectPath);
      if (worktreeMismatch) {
        warn(worktreeMismatchWarning(worktreeMismatch));
      }
      if (snapshotImport) {
        warn(describeSnapshotImportWarning(snapshotImport));
      }
      console.log();

      // Index stats
      console.log(chalk.bold('Index Statistics:'));
      console.log(`  Files:     ${formatNumber(stats.fileCount)}`);
      console.log(`  Nodes:     ${formatNumber(stats.nodeCount)}`);
      console.log(`  Edges:     ${formatNumber(stats.edgeCount)}`);
      console.log(`  DB Size:   ${(stats.dbSizeBytes / 1024 / 1024).toFixed(2)} MB`);
      // Surface the active SQLite backend (node:sqlite — Node's built-in real
      // SQLite, full WAL + FTS5, no native build).
      const backendLabel = chalk.green(`node:sqlite ${getGlyphs().dash} built-in (full WAL)`);
      console.log(`  Backend:   ${backendLabel}`);
      // Effective journal mode: 'wal' means concurrent reads never block on a
      // writer; anything else means they can ("database is locked"). node:sqlite
      // supports WAL everywhere, so a non-wal mode means the filesystem can't
      // (network mounts, WSL2 /mnt). See issue #238.
      const journalLabel = journalMode === 'wal'
        ? chalk.green('wal')
        : chalk.yellow(`${journalMode || 'unknown'} ${getGlyphs().dash} WAL inactive; reads can block on writes`);
      console.log(`  Journal:   ${journalLabel}`);
      console.log();

      // Node breakdown
      console.log(chalk.bold('Nodes by Kind:'));
      const nodesByKind = Object.entries(stats.nodesByKind)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1]);
      for (const [kind, count] of nodesByKind) {
        console.log(`  ${kind.padEnd(15)} ${formatNumber(count)}`);
      }
      console.log();

      // Language breakdown
      console.log(chalk.bold('Files by Language:'));
      const filesByLang = Object.entries(stats.filesByLanguage)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1]);
      for (const [lang, count] of filesByLang) {
        console.log(`  ${lang.padEnd(15)} ${formatNumber(count)}`);
      }
      console.log();

      // Pending changes
      const totalChanges = changes.added.length + changes.modified.length + changes.removed.length;
      if (totalChanges > 0) {
        console.log(chalk.bold('Pending Changes:'));
        if (changes.added.length > 0) {
          console.log(`  Added:     ${changes.added.length} files`);
        }
        if (changes.modified.length > 0) {
          console.log(`  Modified:  ${changes.modified.length} files`);
        }
        if (changes.removed.length > 0) {
          console.log(`  Removed:   ${changes.removed.length} files`);
        }
        info('Run "omniweave sync" to update the index');
      } else {
        success('Index is up to date');
      }
      console.log();

      // Re-index hint: the index was built by an older engine than the one now
      // running, so a rebuild would add data a migration can't backfill.
      if (reindexRecommended) {
        const builtWith = buildInfo.version ? `v${buildInfo.version.replace(/^v/, '')}` : 'an earlier version';
        warn(`Index was built by ${builtWith}; re-index to pick up this engine's improvements.`);
        info('Run "omniweave index -f" (full rebuild) or "omniweave sync"');
        console.log();
      }

      cg.destroy();
    } catch (err) {
      error(`Failed to get status: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * omniweave query <search>
 */
program
  .command('query <search>')
  .description('Search for symbols in the codebase')
  .option('-p, --path <path>', 'Project path')
  .option('-l, --limit <number>', 'Maximum results (1-100)', '10')
  .option('-k, --kind <kind>', 'Filter by node kind (function, class, etc.)')
  .option('-j, --json', 'Output as JSON')
  .action(async (search: string, options: { path?: string; limit?: string; kind?: string; json?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`OmniWeave not initialized in ${projectPath}`);
        process.exit(1);
      }

      const { default: OmniWeave } = await loadOmniWeave();
      const cg = await OmniWeave.open(projectPath);

      const limit = parseCliIntOption(options.limit, 10, 1, 100);
      const kind = options.kind === 'type' ? 'type_alias' : options.kind;
      const rawResults = cg.searchNodes(search, {
        limit,
        kinds: kind ? [kind as any] : undefined,
      });

      // Mirror the MCP search down-rank so the CLI also surfaces the
      // hand-written implementation before protobuf/gRPC scaffolding
      // when both share a name. See extraction/generated-detection.ts.
      const { isGeneratedFile } = await import('../extraction/generated-detection');
      const results = [...rawResults].sort((a, b) => {
        const aGen = isGeneratedFile(a.node.filePath) ? 1 : 0;
        const bGen = isGeneratedFile(b.node.filePath) ? 1 : 0;
        return aGen - bGen;
      });

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          info(`No results found for "${search}"`);
        } else {
          console.log(chalk.bold(`\nSearch Results for "${search}":\n`));

          for (const result of results) {
            const node = result.node;
            const location = `${node.filePath}:${node.startLine}`;
            const score = chalk.dim(`(${(result.score * 100).toFixed(0)}%)`);

            console.log(
              chalk.cyan(node.kind.padEnd(12)) +
              chalk.white(node.name) +
              ' ' + score
            );
            console.log(chalk.dim(`  ${location}`));
            console.log(chalk.dim(`  cmd: ${nodeContinuationCommand(node)}`));
            if (node.signature) {
              console.log(chalk.dim(`  ${node.signature}`));
            }
            console.log();
          }
        }
      }

      cg.destroy();
    } catch (err) {
      error(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * omniweave explore <query...>
 *
 * The CLI face of the MCP omniweave_explore tool — same handler, same
 * output (source of the relevant symbols grouped by file + the call path
 * among them). Exists so agents WITHOUT the MCP tools — Task-tool
 * subagents (which don't inherit MCP tools, #704) and non-MCP harnesses —
 * can reach the graph through a plain shell command.
 */
program
  .command('explore <query...>')
  .description('Explore an area: relevant symbols\' source + call paths in one shot')
  .option('-p, --path <path>', 'Project path')
  .option('--max-files <number>', 'Maximum number of files to include source from (default is adaptive by project size)')
  .action(async (queryParts: string[], options: { path?: string; maxFiles?: string }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        console.log(buildExploreUnavailableMessage(projectPath));
        return;
      }

      const { default: OmniWeave } = await loadOmniWeave();
      const cg = await OmniWeave.open(projectPath);
      const { ToolHandler } = await import('../mcp/tools');
      const handler = new ToolHandler(cg);
      handler.setDefaultProjectHint(projectPath);

      const args: Record<string, unknown> = {
        query: queryParts.join(' '),
      };
      if (options.maxFiles) args.maxFiles = options.maxFiles;
      const result = await handler.execute('omniweave_explore', args, {
        outputSurface: 'cli',
        enforceToolAllowlist: false,
      });

      console.log(result.content[0]?.text ?? '');
      cg.destroy();
      if (result.isError) process.exit(1);
    } catch (err) {
      error(`Explore failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * omniweave node <name>
 *
 * The CLI face of the MCP omniweave_node tool: one symbol's source +
 * caller/callee trail, or a whole file with line numbers + dependents
 * (Read-parity). Same subagent/non-MCP rationale as `explore`.
 */
program
  .command('node <name>')
  .description('One symbol\'s source + caller/callee trail, or read a file with line numbers + dependents')
  .option('-p, --path <path>', 'Project path')
  .option('-f, --file <file>', 'Treat as file mode (or disambiguate a symbol to this file)')
  .option('--line <number>', 'Symbol mode: disambiguate to the definition at or near this line')
  .option('--offset <number>', 'File mode: 1-based start line')
  .option('--limit <number>', 'File mode: maximum lines (1-2000)')
  .option('--symbols-only', 'File mode: just the symbol map + dependents')
  .action(async (name: string, options: { path?: string; file?: string; line?: string; offset?: string; limit?: string; symbolsOnly?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`OmniWeave isn't available here — no .omniweave/ index exists in ${projectPath}. If you are an AI agent: continue with your usual tools; indexing is the user's decision, do not run it yourself. (The project owner can enable OmniWeave with 'omniweave init'.)`);
        process.exit(1);
      }

      const { default: OmniWeave } = await loadOmniWeave();
      const cg = await OmniWeave.open(projectPath);
      const { ToolHandler } = await import('../mcp/tools');
      const handler = new ToolHandler(cg);

      // A name with a path separator is a file read; otherwise a symbol
      // (use --file for basename-only file reads or to pin an overload).
      // Both separators: Windows users type src\auth\session.ts. Symbols
      // never contain either ('/' isn't an identifier char anywhere we
      // index; C++ scope is '::', JS members '.').
      const args: Record<string, unknown> = {};
      if (options.file) {
        args.file = options.file;
        if (name && name !== options.file) {
          args.symbol = name;
          args.includeCode = true;
        }
      } else if (name.includes('/') || name.includes('\\')) {
        args.file = name.replace(/\\/g, '/');
      } else {
        args.symbol = name;
        args.includeCode = true;
      }
      if (options.line) args.line = parseCliIntOption(options.line, 1, 1, Number.MAX_SAFE_INTEGER);
      if (options.offset) args.offset = parseCliIntOption(options.offset, 1, 1, Number.MAX_SAFE_INTEGER);
      if (options.limit) args.limit = parseCliIntOption(options.limit, 2000, 1, 2000);
      if (options.symbolsOnly) args.symbolsOnly = true;

      const result = await handler.execute('omniweave_node', args, {
        outputSurface: 'cli',
        enforceToolAllowlist: false,
      });

      console.log(result.content[0]?.text ?? '');
      cg.destroy();
      if (result.isError) process.exit(1);
    } catch (err) {
      error(`Node lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * omniweave files [path]
 */
program
  .command('files')
  .description('Show project file structure from the index')
  .option('-p, --path <path>', 'Project path')
  .option('--filter <dir>', 'Filter to files under this directory')
  .option('--pattern <glob>', 'Filter files matching this glob pattern')
  .option('--format <format>', 'Output format (tree, flat, grouped)', 'tree')
  .option('--max-depth <number>', 'Maximum directory depth for tree format (1-20)')
  .option('--no-metadata', 'Hide file metadata (language, symbol count)')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: {
    path?: string;
    filter?: string;
    pattern?: string;
    format?: string;
    maxDepth?: string;
    metadata?: boolean;
    json?: boolean;
  }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`OmniWeave not initialized in ${projectPath}`);
        process.exit(1);
      }

      const { default: OmniWeave } = await loadOmniWeave();
      const cg = await OmniWeave.open(projectPath);

      if (!options.json) {
        const { ToolHandler } = await import('../mcp/tools');
        const handler = new ToolHandler(cg);
        const args: Record<string, unknown> = {
          format: options.format || 'tree',
          includeMetadata: options.metadata !== false,
        };
        if (options.filter) args.path = options.filter;
        if (options.pattern) args.pattern = options.pattern;
        if (options.maxDepth) args.maxDepth = parseCliIntOption(options.maxDepth, 20, 1, 20);

        const result = await handler.execute('omniweave_files', args, {
          outputSurface: 'cli',
          enforceToolAllowlist: false,
        });
        console.log(result.content[0]?.text ?? '');
        cg.destroy();
        if (result.isError) process.exit(1);
        return;
      }

      let files = cg.getFiles();

      if (files.length === 0) {
        info('No files indexed. The OmniWeave index is initialized but contains 0 files. This is an empty index state, not a tool failure. Run "omniweave sync" after source files are present.');
        cg.destroy();
        return;
      }

      // Filter by path prefix
      if (options.filter) {
        const filter = normalizeCliFileFilter(options.filter);
        if (filter) files = files.filter(f => f.path === filter || f.path.startsWith(filter + '/'));
      }

      // Filter by glob pattern
      if (options.pattern) {
        const regex = globToRegex(options.pattern);
        files = files.filter(f => regex.test(f.path));
      }

      if (files.length === 0) {
        info('No files found matching the criteria.');
        cg.destroy();
        return;
      }

      // JSON output
      if (options.json) {
        const output = files.map(f => ({
          path: f.path,
          language: f.language,
          nodeCount: f.nodeCount,
          size: f.size,
        }));
        console.log(JSON.stringify(output, null, 2));
        cg.destroy();
        return;
      }

      cg.destroy();
    } catch (err) {
      error(`Failed to list files: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

function normalizeCliFileFilter(filter: string): string {
  return filter
    .replace(/\\/g, '/')
    .replace(/^(?:\.?\/+)+/, '')
    .replace(/^\.$/, '')
    .replace(/\/+$/, '');
}

/**
 * Convert glob pattern to regex
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(escaped);
}

/**
 * omniweave serve
 */
program
  .command('serve')
  .description('Start OmniWeave as an MCP server for AI assistants')
  .option('-p, --path <path>', 'Project path (optional for MCP mode, uses rootUri from client)')
  .option('--mcp', 'Run as MCP server (stdio transport)')
  .option('--no-watch', 'Disable the file watcher (no auto-sync; useful on slow filesystems like WSL2 /mnt drives)')
  .action(async (options: { path?: string; mcp?: boolean; watch?: boolean }) => {
    const projectPath = options.path ? resolveProjectPath(options.path) : undefined;

    // Commander sets watch=false when --no-watch is passed. Route it through
    // the same env-var chokepoint the watcher and MCP server already honor.
    if (options.watch === false) {
      process.env.OMNIWEAVE_NO_WATCH = '1';
    }

    try {
      if (options.mcp) {
        // Start MCP server - it handles initialization lazily based on rootUri from client
        const { MCPServer } = await import('../mcp/index');
        const server = new MCPServer(projectPath);
        await server.start();
        // Server will run until terminated
      } else {
        // Default: show info about MCP mode.
        // Use stderr so stdout stays clean for any piped/stdio usage.
        console.error(chalk.bold('\nOmniWeave MCP Server\n'));
        console.error(chalk.blue(getGlyphs().info) + ' Use --mcp flag to start the MCP server');
        console.error('\nTo use with Claude Code, add to your MCP configuration:');
        console.error(chalk.dim(`
{
  "mcpServers": {
    "omniweave": {
      "command": "omniweave",
      "args": ["serve", "--mcp"]
    }
  }
}
`));
        console.error('Default tools:');
        console.error(chalk.cyan('  omniweave_explore') + '   - Primary: source of the relevant symbols for any question');
        console.error(chalk.cyan('  omniweave_search') + '    - Search for code symbols');
        console.error(chalk.cyan('  omniweave_callers') + '   - Find callers of a symbol');
        console.error(chalk.cyan('  omniweave_impact') + '    - Analyze impact of changes');
        console.error(chalk.cyan('  omniweave_node') + '      - Get symbol details');
        console.error('\nOpt-in tools via OMNIWEAVE_MCP_TOOLS:');
        console.error(chalk.cyan('  omniweave_callees') + '   - Find what a symbol calls');
        console.error(chalk.cyan('  omniweave_files') + '     - Get project file structure');
        console.error(chalk.cyan('  omniweave_status') + '    - Get index status');
      }
    } catch (err) {
      error(`Failed to start server: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * omniweave unlock [path]
 */
program
  .command('unlock [path]')
  .description('Remove a stale lock file that is blocking indexing')
  .action(async (pathArg: string | undefined) => {
    const projectPath = resolveProjectPath(pathArg);

    try {
      if (!isInitialized(projectPath)) {
        error(`OmniWeave not initialized in ${projectPath}`);
        return;
      }

      const lockPath = path.join(getOmniWeaveDir(projectPath), 'omniweave.lock');

      if (!fs.existsSync(lockPath)) {
        info(`No lock file found ${getGlyphs().dash} nothing to do`);
        return;
      }

      fs.unlinkSync(lockPath);
      success('Removed lock file. You can now run indexing again.');
    } catch (err) {
      error(`Failed to remove lock: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * omniweave callers <symbol>
 *
 * CLI parity with the MCP graph tools (omniweave_callers/callees/impact) so the
 * traversal queries work in scripts, CI, and git hooks without a running MCP
 * server.
 */
program
  .command('callers <symbol>')
  .description('Find all functions/methods that call a specific symbol')
  .option('-p, --path <path>', 'Project path')
  .option('-f, --file <file>', 'Narrow to the definition in this file when names repeat')
  .option('-l, --limit <number>', 'Maximum results (1-100)', '20')
  .option('-j, --json', 'Output as JSON')
  .action(async (symbol: string, options: { path?: string; file?: string; limit?: string; json?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`OmniWeave not initialized in ${projectPath}`);
        process.exit(1);
      }

      const { default: OmniWeave } = await loadOmniWeave();
      const cg = await OmniWeave.open(projectPath);
      const limit = parseCliIntOption(options.limit, 20, 1, 100);

      if (!options.json) {
        const { ToolHandler } = await import('../mcp/tools');
        const handler = new ToolHandler(cg);
        const args: Record<string, unknown> = { symbol, limit };
        if (options.file) args.file = options.file;
        const result = await handler.execute('omniweave_callers', args, {
          outputSurface: 'cli',
          enforceToolAllowlist: false,
        });
        console.log(result.content[0]?.text ?? '');
        cg.destroy();
        if (result.isError) process.exit(1);
        return;
      }

      const matches = cg.searchNodes(symbol, { limit: 50 });
      if (matches.length === 0) {
        info(`Symbol "${symbol}" not found`);
        cg.destroy();
        return;
      }

      const {
        nodes: allCallers,
        omittedLowSignal,
        omittedWeak,
        filteredOut,
      } = collectCliCallSurface(matches, symbol, options.file, (nodeId) => cg.getCallers(nodeId));

      const limited = allCallers.slice(0, limit);
      const truncated = allCallers.length > limit;
      const omissionNotes = cliRelationshipOmissionNote(omittedLowSignal, omittedWeak);
      const filterNote = filteredOut && options.file
        ? `No definition of "${symbol}" matches file "${options.file}" — showing all definitions instead.`
        : '';

      if (options.json) {
        // Surface the true total + a `truncated` flag so scripts never read a
        // capped slice as the whole fan-in (MCP parity — see moreResultsNote).
        console.log(JSON.stringify({ symbol, file: options.file, filterMatched: !filteredOut, total: allCallers.length, truncated, omittedLowSignal, omittedWeak, callers: limited }, null, 2));
      } else if (limited.length === 0) {
        info(`No callers found for "${symbol}"`);
        if (filterNote) console.log(chalk.dim(filterNote));
        for (const note of omissionNotes) console.log(chalk.dim(note));
      } else {
        const heading = truncated ? `${limited.length} of ${allCallers.length}` : `${limited.length}`;
        console.log(chalk.bold(`\nCallers of "${symbol}" (${heading}):\n`));
        if (filterNote) console.log(chalk.dim(filterNote + '\n'));
        for (const node of limited) {
          const loc = node.startLine ? `:${node.startLine}` : '';
          console.log(
            chalk.cyan(node.kind.padEnd(12)) +
            chalk.white(node.name)
          );
          console.log(chalk.dim(`  ${node.filePath}${loc}`));
          console.log();
        }
        if (truncated) console.log(chalk.yellow(`  … ${allCallers.length - limit} more — re-run with --limit ${Math.min(allCallers.length, 100)} for the full list.\n`));
        for (const note of omissionNotes) console.log(chalk.dim(note));
      }

      cg.destroy();
    } catch (err) {
      error(`callers failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * omniweave callees <symbol>
 */
program
  .command('callees <symbol>')
  .description('Find all functions/methods that a specific symbol calls')
  .option('-p, --path <path>', 'Project path')
  .option('-f, --file <file>', 'Narrow to the definition in this file when names repeat')
  .option('-l, --limit <number>', 'Maximum results (1-100)', '20')
  .option('-j, --json', 'Output as JSON')
  .action(async (symbol: string, options: { path?: string; file?: string; limit?: string; json?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`OmniWeave not initialized in ${projectPath}`);
        process.exit(1);
      }

      const { default: OmniWeave } = await loadOmniWeave();
      const cg = await OmniWeave.open(projectPath);
      const limit = parseCliIntOption(options.limit, 20, 1, 100);

      if (!options.json) {
        const { ToolHandler } = await import('../mcp/tools');
        const handler = new ToolHandler(cg);
        const args: Record<string, unknown> = { symbol, limit };
        if (options.file) args.file = options.file;
        const result = await handler.execute('omniweave_callees', args, {
          outputSurface: 'cli',
          enforceToolAllowlist: false,
        });
        console.log(result.content[0]?.text ?? '');
        cg.destroy();
        if (result.isError) process.exit(1);
        return;
      }

      const matches = cg.searchNodes(symbol, { limit: 50 });
      if (matches.length === 0) {
        info(`Symbol "${symbol}" not found`);
        cg.destroy();
        return;
      }

      const {
        nodes: allCallees,
        omittedLowSignal,
        omittedWeak,
        filteredOut,
      } = collectCliCallSurface(matches, symbol, options.file, (nodeId) => cg.getCallees(nodeId));

      const limited = allCallees.slice(0, limit);
      const truncated = allCallees.length > limit;
      const omissionNotes = cliRelationshipOmissionNote(omittedLowSignal, omittedWeak);
      const filterNote = filteredOut && options.file
        ? `No definition of "${symbol}" matches file "${options.file}" — showing all definitions instead.`
        : '';

      if (options.json) {
        console.log(JSON.stringify({ symbol, file: options.file, filterMatched: !filteredOut, total: allCallees.length, truncated, omittedLowSignal, omittedWeak, callees: limited }, null, 2));
      } else if (limited.length === 0) {
        info(`No callees found for "${symbol}"`);
        if (filterNote) console.log(chalk.dim(filterNote));
        for (const note of omissionNotes) console.log(chalk.dim(note));
      } else {
        const heading = truncated ? `${limited.length} of ${allCallees.length}` : `${limited.length}`;
        console.log(chalk.bold(`\nCallees of "${symbol}" (${heading}):\n`));
        if (filterNote) console.log(chalk.dim(filterNote + '\n'));
        for (const node of limited) {
          const loc = node.startLine ? `:${node.startLine}` : '';
          console.log(
            chalk.cyan(node.kind.padEnd(12)) +
            chalk.white(node.name)
          );
          console.log(chalk.dim(`  ${node.filePath}${loc}`));
          console.log();
        }
        if (truncated) console.log(chalk.yellow(`  … ${allCallees.length - limit} more — re-run with --limit ${Math.min(allCallees.length, 100)} for the full list.\n`));
        for (const note of omissionNotes) console.log(chalk.dim(note));
      }

      cg.destroy();
    } catch (err) {
      error(`callees failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * omniweave impact <symbol>
 */
program
  .command('impact <symbol>')
  .description('Analyze what code is affected by changing a symbol')
  .option('-p, --path <path>', 'Project path')
  .option('-f, --file <file>', 'Narrow to the definition in this file when names repeat')
  .option('-d, --depth <number>', 'Traversal depth (1-10)', '2')
  .option('-j, --json', 'Output as JSON')
  .action(async (symbol: string, options: { path?: string; file?: string; depth?: string; json?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`OmniWeave not initialized in ${projectPath}`);
        process.exit(1);
      }

      const { default: OmniWeave } = await loadOmniWeave();
      const cg = await OmniWeave.open(projectPath);
      const depth = parseCliIntOption(options.depth, 2, 1, 10);

      if (!options.json) {
        const { ToolHandler } = await import('../mcp/tools');
        const handler = new ToolHandler(cg);
        const args: Record<string, unknown> = { symbol, depth };
        if (options.file) args.file = options.file;
        const result = await handler.execute('omniweave_impact', args, {
          outputSurface: 'cli',
          enforceToolAllowlist: false,
        });
        console.log(result.content[0]?.text ?? '');
        cg.destroy();
        if (result.isError) process.exit(1);
        return;
      }

      const matches = cg.searchNodes(symbol, { limit: 50 });
      if (matches.length === 0) {
        info(`Symbol "${symbol}" not found`);
        cg.destroy();
        return;
      }

      // Merge impact subgraphs across all exact-matching symbols
      const mergedNodes = new Map<string, { name: string; kind: string; filePath: string; startLine?: number }>();
      const seenEdges = new Set<string>();
      let edgeCount = 0;

      const narrowed = narrowCliSymbolMatches(matches, symbol, options.file);
      for (const match of narrowed.matches) {
        const impact = cg.getImpactRadius(match.node.id, depth);
        for (const [id, n] of impact.nodes) {
          mergedNodes.set(id, { name: n.name, kind: n.kind, filePath: n.filePath, startLine: n.startLine });
        }
        for (const e of impact.edges) {
          const key = `${e.source}->${e.target}:${e.kind}`;
          if (!seenEdges.has(key)) {
            seenEdges.add(key);
            edgeCount++;
          }
        }
      }

      // Fallback to top match if exact filter removed everything
      if (mergedNodes.size === 0 && matches[0]) {
        const impact = cg.getImpactRadius(matches[0].node.id, depth);
        for (const [id, n] of impact.nodes) {
          mergedNodes.set(id, { name: n.name, kind: n.kind, filePath: n.filePath, startLine: n.startLine });
        }
        edgeCount = impact.edges.length;
      }

      if (options.json) {
        console.log(JSON.stringify({
          symbol,
          file: options.file,
          filterMatched: !narrowed.filteredOut,
          depth,
          nodeCount: mergedNodes.size,
          edgeCount,
          affected: Array.from(mergedNodes.values()),
        }, null, 2));
      } else if (mergedNodes.size === 0) {
        info(`No affected symbols found for "${symbol}"`);
      } else {
        console.log(chalk.bold(`\nImpact of changing "${symbol}" — ${mergedNodes.size} affected symbols:\n`));
        if (narrowed.filteredOut && options.file) {
          console.log(chalk.dim(`No definition of "${symbol}" matches file "${options.file}" — showing all definitions instead.\n`));
        }

        // Group by file
        const byFile = new Map<string, Array<{ name: string; kind: string; startLine?: number }>>();
        for (const node of mergedNodes.values()) {
          const list = byFile.get(node.filePath) || [];
          list.push({ name: node.name, kind: node.kind, startLine: node.startLine });
          byFile.set(node.filePath, list);
        }

        for (const [file, nodes] of byFile) {
          console.log(chalk.cyan(file));
          for (const node of nodes) {
            const loc = node.startLine ? `:${node.startLine}` : '';
            console.log(`  ${chalk.dim(node.kind.padEnd(12))}${node.name}${chalk.dim(loc)}`);
          }
          console.log();
        }
      }

      cg.destroy();
    } catch (err) {
      error(`impact failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * omniweave affected [files...]
 *
 * Find test files affected by the given source files.
 * Traces dependency edges transitively to find test files that depend on changed code.
 *
 * Usage:
 *   git diff --name-only | omniweave affected --stdin
 *   omniweave affected src/lib/components/Editor.svelte src/routes/+page.svelte
 */
program
  .command('affected [files...]')
  .description('Find test files affected by changed source files')
  .option('-p, --path <path>', 'Project path')
  .option('--stdin', 'Read file list from stdin (one per line)')
  .option('-d, --depth <number>', 'Max dependency traversal depth (1-50)', '5')
  .option('-f, --filter <glob>', 'Custom glob filter for test files (e.g. "e2e/*.spec.ts")')
  .option('-j, --json', 'Output as JSON')
  .option('-q, --quiet', 'Only output file paths, no decoration')
  .action(async (fileArgs: string[], options: { path?: string; stdin?: boolean; depth?: string; filter?: string; json?: boolean; quiet?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`OmniWeave not initialized in ${projectPath}`);
        process.exit(1);
      }

      // Collect changed files from args or stdin
      let changedFiles: string[] = [...(fileArgs || [])];

      if (options.stdin) {
        const stdinData = fs.readFileSync(0, 'utf-8');
        const stdinFiles = stdinData.split('\n').map(f => f.trim()).filter(Boolean);
        changedFiles.push(...stdinFiles);
      }

      if (changedFiles.length === 0) {
        if (!options.quiet) info('No files provided. Use file arguments or --stdin.');
        process.exit(0);
      }

      const { default: OmniWeave } = await loadOmniWeave();
      const cg = await OmniWeave.open(projectPath);
      const maxDepth = parseCliIntOption(options.depth, 5, 1, 50);

      // Common test file patterns
      const defaultTestPatterns = [
        /\.spec\./,
        /\.test\./,
        /\/__tests__\//,
        /\/tests?\//,
        /\/e2e\//,
        /\/spec\//,
      ];

      // Custom filter pattern
      let customFilter: RegExp | null = null;
      if (options.filter) {
        // Convert glob to regex: ** → .+, * → [^/]*, . → \.
        const regex = options.filter
          .replace(/[+[\]{}()^$|\\]/g, '\\$&')
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '.+')
          .replace(/\*/g, '[^/]*');
        customFilter = new RegExp(regex);
      }

      function isTestFile(filePath: string): boolean {
        if (customFilter) return customFilter.test(filePath);
        return defaultTestPatterns.some(p => p.test(filePath));
      }

      // BFS to find all transitive dependents of changed files, filtered to test files
      const affectedTests = new Set<string>();
      const allDependents = new Set<string>();

      for (const file of changedFiles) {
        // If the changed file is itself a test file, include it
        if (isTestFile(file)) {
          affectedTests.add(file);
          continue;
        }

        // BFS through dependents
        const queue: Array<{ file: string; depth: number }> = [{ file, depth: 0 }];
        const visited = new Set<string>();
        visited.add(file);

        while (queue.length > 0) {
          const current = queue.shift()!;
          if (current.depth >= maxDepth) continue;

          const dependents = cg.getFileDependents(current.file);
          for (const dep of dependents) {
            if (visited.has(dep)) continue;
            visited.add(dep);
            allDependents.add(dep);

            if (isTestFile(dep)) {
              affectedTests.add(dep);
            } else {
              queue.push({ file: dep, depth: current.depth + 1 });
            }
          }
        }
      }

      const sortedTests = Array.from(affectedTests).sort();

      // Output
      if (options.json) {
        console.log(JSON.stringify({
          changedFiles,
          affectedTests: sortedTests,
          totalDependentsTraversed: allDependents.size,
        }, null, 2));
      } else if (options.quiet) {
        for (const t of sortedTests) console.log(t);
      } else {
        if (sortedTests.length === 0) {
          info('No test files affected by the changed files.');
        } else {
          console.log(chalk.bold(`\nAffected test files (${sortedTests.length}):\n`));
          for (const t of sortedTests) {
            console.log('  ' + chalk.cyan(t));
          }
          console.log();
        }
      }

      cg.destroy();
    } catch (err) {
      error(`Affected analysis failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * omniweave snapshot export <output-dir>
 *
 * Creates a portable, versioned graph artifact. Import stays intentionally
 * separate so the first contract is a verifiable bundle, not a hidden cache swap.
 */
const snapshotCommand = program
  .command('snapshot')
  .description('Export, verify, or import versioned OmniWeave graph artifacts');

snapshotCommand
  .command('export <outputDir>')
  .description('Export the current graph database plus a hash-verified manifest')
  .option('-p, --path <path>', 'Project path')
  .option('-f, --force', 'Overwrite existing snapshot files in the output directory')
  .option('-j, --json', 'Output manifest metadata as JSON')
  .action(async (outputDir: string, options: { path?: string; force?: boolean; json?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`OmniWeave not initialized in ${projectPath}`);
        process.exit(1);
      }

      const { exportSnapshot } = await import('../snapshot');
      const result = await exportSnapshot(projectPath, outputDir, {
        force: options.force === true,
        omniweaveVersion: packageJson.version,
      });

      if (options.json) {
        console.log(JSON.stringify(result.manifest, null, 2));
      } else {
        success(`Snapshot exported to ${result.directory}`);
        info(`Manifest: ${result.manifestPath}`);
        info(`Database: ${result.databasePath}`);
        info(`Fingerprint: ${result.manifest.sourceRoot.fingerprint}`);
      }
    } catch (err) {
      error(`Snapshot export failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

snapshotCommand
  .command('verify <snapshotDir>')
  .description('Verify a snapshot manifest, artifact hashes, and optional target staleness')
  .option('-p, --path <path>', 'Project path to compare indexed file hashes against')
  .option('-j, --json', 'Output verification metadata as JSON')
  .action(async (snapshotDir: string, options: { path?: string; json?: boolean }) => {
    try {
      const { verifySnapshot } = await import('../snapshot');
      const result = await verifySnapshot(snapshotDir, {
        projectRoot: options.path ? path.resolve(options.path) : undefined,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.ok) {
          success(`Snapshot verified: ${result.directory}`);
          if (result.manifest) {
            info(`Manifest: ${result.manifestPath}`);
            info(`Fingerprint: ${result.manifest.sourceRoot.fingerprint}`);
          }
          if (!result.targetChecked) {
            info('Target project: not checked (pass --path <project> to validate target staleness and import policy).');
          }
        } else {
          error(`Snapshot verification failed: ${result.errors.join('; ')}`);
        }
        for (const message of result.warnings) warn(message);
      }

      if (!result.ok) process.exit(1);
    } catch (err) {
      error(`Snapshot verify failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

snapshotCommand
  .command('import <snapshotDir>')
  .description('Import a verified snapshot into a project .omniweave directory')
  .option('-p, --path <path>', 'Project path')
  .option('-f, --force', 'Replace existing OmniWeave database files in the target project')
  .option('--allow-stale', 'Import even when indexed files differ from the target working tree')
  .option('--allow-unsafe-root', 'Import into a filesystem root, home directory, or home ancestor')
  .option('-j, --json', 'Output import metadata as JSON')
  .action(async (snapshotDir: string, options: { path?: string; force?: boolean; allowStale?: boolean; allowUnsafeRoot?: boolean; json?: boolean }) => {
    const projectPath = options.path ? path.resolve(options.path) : resolveProjectPath();

    try {
      const { importSnapshot } = await import('../snapshot');
      const result = await importSnapshot(snapshotDir, projectPath, {
        force: options.force === true,
        allowStale: options.allowStale === true,
        allowUnsafeRoot: options.allowUnsafeRoot === true,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        success(`Snapshot imported into ${result.projectRoot}`);
        info(`Database: ${result.databasePath}`);
        info(`Fingerprint: ${result.manifest.sourceRoot.fingerprint}`);
        for (const message of result.warnings) warn(message);
      }
    } catch (err) {
      error(`Snapshot import failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

const scipCommand = program
  .command('scip')
  .description('Import optional SCIP precision facts');

scipCommand
  .command('import <indexFile>')
  .description('Import definitions, references, and relationships from an existing index.scip')
  .option('-p, --path <path>', 'Project path')
  .option('--keep-existing', 'Keep existing SCIP facts instead of replacing them first')
  .option('-j, --json', 'Output import metadata as JSON')
  .action(async (indexFile: string, options: { path?: string; keepExisting?: boolean; json?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    try {
      if (!isInitialized(projectPath)) {
        error(`OmniWeave not initialized in ${projectPath}`);
        process.exit(1);
      }

      const { importScipIndex } = await import('../scip/importer');
      const result = await importScipIndex(projectPath, indexFile, {
        replace: options.keepExisting !== true,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        success(`SCIP facts imported into ${result.projectRoot}`);
        info(`Documents: ${result.documentsImported}/${result.documentsRead}`);
        info(`Nodes: ${result.nodesImported}  Edges: ${result.edgesImported}`);
        info(`References: ${result.referencesImported}  Relationships: ${result.relationshipsImported}`);
        for (const message of result.warnings) warn(message);
      }
    } catch (err) {
      error(`SCIP import failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * omniweave install
 */
program
  .command('install')
  .description('Install omniweave MCP server into one or more agents (Claude Code, Cursor, Codex CLI, opencode, Hermes Agent)')
  .option('-t, --target <ids>', 'Target agent(s): comma-separated ids, or "auto"|"all"|"none". Default: prompt')
  .option('-l, --location <where>', 'Install location: "global" or "local". Default: prompt')
  .option('-y, --yes', 'Non-interactive: defaults to --location=global --target=auto, auto-allow on')
  .option('--no-permissions', 'Skip writing the auto-allow permissions list (Claude Code only)')
  .option('--print-config <id>', 'Print MCP config snippet for the named agent and exit (no file writes)')
  .action(async (opts: {
    target?: string;
    location?: string;
    yes?: boolean;
    permissions?: boolean;
    printConfig?: string;
  }) => {
    if (opts.printConfig) {
      const { getTarget, listTargetIds } = await import('../installer/targets/registry');
      const target = getTarget(opts.printConfig);
      if (!target) {
        const known = listTargetIds().join(', ');
        error(`Unknown target "${opts.printConfig}". Known: ${known}.`);
        process.exit(1);
      }
      const loc = (opts.location === 'local' ? 'local' : 'global') as 'global' | 'local';
      process.stdout.write(target.printConfig(loc));
      return;
    }

    const { runInstallerWithOptions } = await import('../installer');
    if (opts.location && opts.location !== 'global' && opts.location !== 'local') {
      error(`--location must be "global" or "local" (got "${opts.location}").`);
      process.exit(1);
    }
    try {
      // Commander's `--no-permissions` makes `opts.permissions === false`;
      // omitting the flag leaves it `true` (the positive-form default).
      // We MUST treat the default-true as "user did not override — let
      // the orchestrator prompt" and only forward an explicit `false`
      // (or `true` when --yes implies it). Otherwise the auto-allow
      // prompt is silently skipped on every interactive run.
      const explicitNoPermissions = opts.permissions === false;
      const autoAllow: boolean | undefined = explicitNoPermissions
        ? false
        : opts.yes
          ? true
          : undefined;

      await runInstallerWithOptions({
        target: opts.target,
        location: opts.location as 'global' | 'local' | undefined,
        autoAllow,
        yes: opts.yes,
      });
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

/**
 * omniweave uninstall
 *
 * Inverse of `install`. Removes the omniweave MCP server entry,
 * instructions block, and permissions from every agent (or a
 * `--target` subset). Prompts global-vs-local when not given. Does NOT
 * delete the `.omniweave/` index — that's `omniweave uninit`.
 */
program
  .command('uninstall')
  .description('Remove omniweave from your agents (Claude Code, Cursor, Codex CLI, opencode, Hermes Agent)')
  .option('-t, --target <ids>', 'Target agent(s): comma-separated ids, or "all". Default: all')
  .option('-l, --location <where>', 'Uninstall location: "global" or "local". Default: prompt')
  .option('-y, --yes', 'Non-interactive: defaults to --location=global --target=all')
  .action(async (opts: {
    target?: string;
    location?: string;
    yes?: boolean;
  }) => {
    const { runUninstaller } = await import('../installer');
    if (opts.location && opts.location !== 'global' && opts.location !== 'local') {
      error(`--location must be "global" or "local" (got "${opts.location}").`);
      process.exit(1);
    }
    try {
      await runUninstaller({
        target: opts.target,
        location: opts.location as 'global' | 'local' | undefined,
        yes: opts.yes,
      });
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

/**
 * omniweave telemetry [on|off|status]
 */
program
  .command('telemetry [action]')
  .description('Show or change anonymous usage telemetry (status, on, off)')
  .action((action?: string) => {
    const t = getTelemetry();

    if (action === 'on' || action === 'off') {
      t.setEnabled(action === 'on', 'cli');
      if (action === 'on') {
        success('Telemetry enabled — anonymous usage stats only (no code, paths, or names).');
      } else {
        success('Telemetry disabled. Buffered, unsent data was deleted.');
      }
      const effective = t.getStatus();
      if (effective.decidedBy === 'DO_NOT_TRACK' || effective.decidedBy === 'OMNIWEAVE_TELEMETRY') {
        warn(
          `The ${effective.decidedBy} environment variable overrides this choice — ` +
          `effective state right now: ${effective.enabled ? 'enabled' : 'disabled'}.`
        );
      }
      return;
    }

    if (action !== undefined && action !== 'status') {
      error(`Unknown action: ${action} (expected status, on, or off)`);
      process.exit(1);
    }

    const s = t.getStatus();
    const decidedBy: Record<typeof s.decidedBy, string> = {
      DO_NOT_TRACK: 'DO_NOT_TRACK environment variable',
      OMNIWEAVE_TELEMETRY: 'OMNIWEAVE_TELEMETRY environment variable',
      config: 'your saved choice',
      default: 'default',
    };
    console.log(`\nTelemetry: ${s.enabled ? chalk.green('enabled') : chalk.yellow('disabled')} ${chalk.dim(`(${decidedBy[s.decidedBy]})`)}`);
    console.log(`Machine ID: ${s.machineId ?? chalk.dim('(random UUID, created on first use)')}`);
    console.log(`Config:     ${s.configPath}`);
    console.log(chalk.dim(`\nExactly what is collected (and never collected): ${TELEMETRY_DOCS}\n`));
  });

/**
 * omniweave upgrade [version]
 *
 * Self-update, however OmniWeave was installed (bundle via install.sh/.ps1,
 * npm-global, npx, or a source checkout). See ../upgrade for the detection and
 * per-method upgrade logic.
 */
program
  .command('upgrade [version]')
  .description('Update OmniWeave to the latest release (or a specific version)')
  .option('--check', 'Check whether an update is available without installing')
  .option('-f, --force', 'Reinstall even if already on the target version')
  .action(async (versionArg: string | undefined, options: { check?: boolean; force?: boolean }) => {
    const up = await import('../upgrade');
    const method = up.detectInstallMethod({
      filename: __filename,
      platform: process.platform,
      cwd: process.cwd(),
    });
    const pin = versionArg || process.env.OMNIWEAVE_VERSION || undefined;
    const code = await up.runUpgrade(
      { version: pin, check: options.check, force: options.force },
      {
        currentVersion: packageJson.version,
        method,
        resolveLatest: () => up.resolveLatestVersion(),
        run: up.defaultRun,
        hasCommand: up.hasCommand,
        log: (m: string) => console.log(m),
        warn: (m: string) => warn(m),
        error: (m: string) => error(m),
        platform: process.platform,
      }
    );
    process.exit(code);
  });

// Parse and run
program.parse();

} // end main()
