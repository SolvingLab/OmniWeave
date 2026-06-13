/**
 * Workflow DSL resolver (Snakemake / Nextflow) — Phase 1·B.
 *
 * A bioinformatics pipeline is a graph of STEPS (Snakemake `rule`, Nextflow
 * `process`) that run command-line tools and cross-language scripts and pass
 * data between each other through files. The base graph only sees intra-process
 * code; the workflow layer it cannot read is exactly where a pipeline's control
 * flow lives. There is no tree-sitter grammar for either DSL, so this resolver
 * extracts step nodes by regex over the original file content (the
 * `FrameworkResolver.extract` hook — same grammar-less path as Play's
 * `conf/routes`). The cross-process `crossLang` edges that wire a step to the
 * R/Python script it shells out to are synthesized post-resolution (see
 * `callback-synthesizer.ts` `workflowCrossLangEdges`).
 *
 * Workflow files are tagged `python` (EXTENSION_MAP / detectLanguage), so the
 * Python grammar already extracts any embedded helper functions; this resolver
 * adds ONLY the step nodes, distinguished by the `workflow-step:` id prefix so
 * downstream passes can tell a rule/process apart from a plain Python function.
 */

import { Node } from '../../types';
import { FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef } from '../types';

/** Step-node id prefix — lets the crossLang synthesizer filter steps in O(1). */
export const WORKFLOW_STEP_PREFIX = 'workflow-step:';
/** Artifact-node id prefix; path-keyed so a producer and consumer share one node. */
export const WORKFLOW_ARTIFACT_PREFIX = 'workflow-artifact:';
/** Tool-node id prefix; name-keyed so every step running a tool shares one node. */
export const WORKFLOW_TOOL_PREFIX = 'workflow-tool:';

function isSnakemakeFile(filePath: string): boolean {
  return filePath.endsWith('.smk') || filePath === 'Snakefile' || filePath.endsWith('/Snakefile');
}
function isNextflowFile(filePath: string): boolean {
  return filePath.endsWith('.nf');
}
export function isWorkflowFile(filePath: string): boolean {
  return isSnakemakeFile(filePath) || isNextflowFile(filePath);
}

/** Leading-whitespace width of a line (tabs counted as one column, matching tree-sitter). */
function indentOf(line: string): number {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
  return i;
}

// Snakemake: `rule align:` / `checkpoint foo:` — a step. `rule all:` (the output
// aggregator) is a real rule too and extracted like any other.
const SNAKE_RULE_RE = /^(\s*)(rule|checkpoint)\s+(\w+)\s*:/;
// Nextflow DSL2: `process FOO {` / `workflow BAR {` (anonymous `workflow {` has no name → skipped).
const NF_BLOCK_RE = /^(\s*)(process|workflow)\s+(\w+)\s*\{/;

/**
 * End line (1-indexed, inclusive) of a Snakemake rule block that opened at
 * `headerIdx` (0-indexed): the block runs while lines are blank or indented
 * deeper than the header, and ends at the first line indented at or below it.
 */
function snakeBlockEnd(lines: string[], headerIdx: number, headerIndent: number): number {
  let end = headerIdx;
  for (let j = headerIdx + 1; j < lines.length; j++) {
    const line = lines[j]!;
    if (line.trim() === '') continue; // blanks belong to the block until a dedent proves otherwise
    if (indentOf(line) <= headerIndent) break;
    end = j;
  }
  return end + 1;
}

/**
 * End line (1-indexed, inclusive) of a Nextflow block whose opening `{` is on
 * `headerIdx`: brace-matched, tolerant of braces in strings (best-effort — a
 * brace inside a quoted shell string is rare in process bodies and only widens
 * the span, never corrupts a node).
 */
function nfBlockEnd(lines: string[], headerIdx: number): number {
  let depth = 0;
  for (let j = headerIdx; j < lines.length; j++) {
    for (const ch of lines[j]!) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth <= 0 && j > headerIdx) return j + 1;
    if (depth <= 0 && j === headerIdx && lines[j]!.includes('}')) return j + 1;
  }
  return lines.length;
}

function stepNode(filePath: string, name: string, startLine: number, endLine: number): Node {
  return {
    id: `${WORKFLOW_STEP_PREFIX}${filePath}:${startLine}:${name}`,
    kind: 'function', // a step is a named, callable unit — reuses callable graph intelligence
    name,
    qualifiedName: `${filePath}::${name}`,
    filePath,
    language: 'python',
    startLine,
    endLine,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  };
}

/**
 * Artifact node for a data file a step produces/consumes. Path-keyed id so the
 * rule that writes `aligned/{s}.bam` and the rule that reads it land on ONE node
 * (that shared node IS the DAG edge between them). `filePath` is the declaring
 * workflow file so the node is cleaned up when that file re-indexes.
 */
function artifactNode(path: string, declaredIn: string): Node {
  return {
    id: `${WORKFLOW_ARTIFACT_PREFIX}${path}`,
    kind: 'artifact',
    name: path,
    qualifiedName: path,
    filePath: declaredIn,
    language: 'python',
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  };
}

/**
 * Tool node for an external command-line binary a step runs (bwa, STAR, samtools).
 * Name-keyed id so every step that runs the tool lands on ONE node — `callers(STAR)`
 * then lists the whole pipeline's use. It has no repo source (a separate process),
 * which is exactly why crossLang (local scripts) doesn't cover it and LSP can't follow.
 */
function toolNode(name: string, declaredIn: string): Node {
  return {
    id: `${WORKFLOW_TOOL_PREFIX}${name}`,
    kind: 'tool',
    name,
    qualifiedName: name,
    filePath: declaredIn,
    language: 'python',
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  };
}

// snakemake-wrappers path → the wrapped tool: `v7.2.0/bio/star/align` → `star`,
// `bio/fastp` → `fastp`, `bio/sra-tools/fasterq-dump` → `sra-tools`. The `bio/<tool>`
// taxonomy names the tool with no shell to parse, so this is a high-precision signal
// (no shell-builtin/coreutils denylist needed — that is the heuristic shell path, a
// documented follow-up).
const WRAPPER_TOOL_RE = /\bbio\/([a-z0-9][a-z0-9_-]*)/;

// A directive header inside a step body: `input:` / `output:` / `shell:` / `script:` …
const DIRECTIVE_HEAD_RE = /^(\s*)(\w+)\s*:/;
const QUOTED_RE = /["']([^"'\n]+)["']/g;
/** A quoted string that names a data file (has an extension, a path separator, or a wildcard). */
function looksLikeArtifact(s: string): boolean {
  return /[./]/.test(s) || s.includes('{');
}

/**
 * Quoted file paths declared under a step's `input:` or `output:` directive.
 * Scans the step body, enters the named directive's section, and collects quoted
 * artifact-looking strings until the next directive at the same-or-shallower
 * indent. Handles Snakemake (`bam="a/{s}.bam"`, `expand("a/{s}.bam", ...)`) and
 * Nextflow (`path "out.rds"`); bare `path counts` (a channel variable, no literal
 * path) yields nothing — honest, the file is only known at runtime.
 */
function directiveArtifacts(bodyLines: string[], directive: 'input' | 'output'): string[] {
  const out: string[] = [];
  let inSection = false;
  let sectionIndent = -1;
  for (const raw of bodyLines) {
    const head = raw.match(DIRECTIVE_HEAD_RE);
    if (head) {
      const indent = head[1]!.length;
      if (head[2] === directive) {
        inSection = true;
        sectionIndent = indent;
      } else if (inSection && indent <= sectionIndent) {
        inSection = false;
      }
    }
    if (!inSection) continue;
    QUOTED_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = QUOTED_RE.exec(raw))) {
      if (looksLikeArtifact(m[1]!)) out.push(m[1]!);
    }
  }
  return out;
}

/**
 * External tools a step runs, read from its `wrapper:` directive section (the path
 * may sit on the directive line or the next line — both are covered by scanning the
 * section). Snakemake-wrapper paths only; the heuristic shell-command path (with a
 * builtin/coreutils denylist) is a documented follow-up. Deduped within the step.
 */
function stepWrapperTools(bodyLines: string[]): string[] {
  const out = new Set<string>();
  let inSection = false;
  let sectionIndent = -1;
  for (const raw of bodyLines) {
    const head = raw.match(DIRECTIVE_HEAD_RE);
    if (head) {
      const indent = head[1]!.length;
      if (head[2] === 'wrapper') {
        inSection = true;
        sectionIndent = indent;
      } else if (inSection && indent <= sectionIndent) {
        inSection = false;
      }
    }
    if (!inSection) continue;
    const m = raw.match(WRAPPER_TOOL_RE);
    if (m) out.add(m[1]!);
  }
  return [...out];
}

export const workflowResolver: FrameworkResolver = {
  name: 'workflow',
  languages: ['python'], // .smk/.nf/Snakefile are all tagged python

  detect(context: ResolutionContext): boolean {
    if (context.fileExists('nextflow.config')) return true;
    return context.getAllFiles().some((f) => isWorkflowFile(f));
  },

  // Opt artifact-path reference names through the resolver pre-filter (a path is
  // not a declared symbol name, so it would otherwise be dropped).
  claimsReference(name: string): boolean {
    return looksLikeArtifact(name);
  },

  // Resolves the produces/consumes references emitted by extract() to their
  // artifact node (path-keyed name match). crossLang edges are synthesized
  // post-resolution, not resolved here.
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // step → external tool (name-keyed; a wrapper path is unambiguous, hence 1.0).
    if (ref.referenceKind === 'invokes') {
      const tool = context.getNodesByName(ref.referenceName).find((n) => n.kind === 'tool');
      return tool ? { original: ref, targetNodeId: tool.id, confidence: 1.0, resolvedBy: 'framework' } : null;
    }
    if (ref.referenceKind !== 'produces' && ref.referenceKind !== 'consumes') return null;
    const art = context.getNodesByName(ref.referenceName).find((n) => n.kind === 'artifact');
    if (!art) return null;
    return { original: ref, targetNodeId: art.id, confidence: 1.0, resolvedBy: 'framework' };
  },

  extract(filePath: string, content: string): { nodes: Node[]; references: UnresolvedRef[] } {
    if (!isWorkflowFile(filePath)) return { nodes: [], references: [] };
    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const lines = content.split('\n');
    const snake = isSnakemakeFile(filePath);
    const artifactsSeen = new Set<string>(); // dedup artifact nodes within this file
    const toolsSeen = new Set<string>(); // dedup tool nodes within this file

    // A step's `wrapper:` names the external tool it runs → `invokes` edge to a
    // name-keyed tool node (shared across every step that runs it).
    const linkTools = (step: Node, bodyLines: string[]) => {
      for (const tool of stepWrapperTools(bodyLines)) {
        if (!toolsSeen.has(tool)) {
          toolsSeen.add(tool);
          nodes.push(toolNode(tool, filePath));
        }
        references.push({
          fromNodeId: step.id,
          referenceName: tool,
          referenceKind: 'invokes',
          line: step.startLine,
          column: 0,
          filePath,
          language: 'python',
        });
      }
    };

    // A rule's input → consumes, output → produces. Both wire step → artifact;
    // a shared artifact node is the DAG edge between the producer and consumer.
    const linkDataflow = (step: Node, bodyLines: string[]) => {
      for (const [directive, kind] of [['input', 'consumes'], ['output', 'produces']] as const) {
        for (const path of directiveArtifacts(bodyLines, directive)) {
          if (!artifactsSeen.has(path)) {
            artifactsSeen.add(path);
            nodes.push(artifactNode(path, filePath));
          }
          references.push({
            fromNodeId: step.id,
            referenceName: path,
            referenceKind: kind,
            line: step.startLine,
            column: 0,
            filePath,
            language: 'python',
          });
        }
      }
    };

    for (let i = 0; i < lines.length; i++) {
      let name: string | null = null;
      let endLine = i + 1;
      if (snake) {
        const m = lines[i]!.match(SNAKE_RULE_RE);
        if (!m) continue;
        name = m[3]!;
        endLine = snakeBlockEnd(lines, i, m[1]!.length);
      } else {
        const m = lines[i]!.match(NF_BLOCK_RE);
        if (!m || m[2] === 'workflow') continue; // processes are the steps; workflow blocks are orchestration
        name = m[3]!;
        endLine = nfBlockEnd(lines, i);
      }
      const step = stepNode(filePath, name, i + 1, endLine);
      nodes.push(step);
      const body = lines.slice(i, endLine);
      linkDataflow(step, body);
      linkTools(step, body);
    }

    return { nodes, references };
  },
};
