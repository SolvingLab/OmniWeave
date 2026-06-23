import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getOmniWeaveDir, isInitialized, validateDirectory } from '../directory';
import { DatabaseConnection, getDatabasePath } from '../db';
import { QueryBuilder } from '../db/queries';
import { FileLock, validatePathWithinRoot } from '../utils';
import { LANGUAGES, type Edge, type EdgeKind, type Language, type Node as GraphNode, type NodeKind } from '../types';
import {
  decodeScipIndexFile,
  SCIP_SYMBOL_ROLE_DEFINITION,
  SCIP_SYMBOL_ROLE_FORWARD_DEFINITION,
  type ScipDocument,
  type ScipIndex,
  type ScipOccurrence,
  type ScipRelationship,
  type ScipSymbolInformation,
} from './protobuf';

export interface ImportScipOptions {
  replace?: boolean;
}

export interface ImportScipResult {
  indexPath: string;
  projectRoot: string;
  documentsRead: number;
  documentsImported: number;
  nodesImported: number;
  edgesImported: number;
  deletedScipNodes: number;
  deletedScipEdges: number;
  referencesImported: number;
  relationshipsImported: number;
  skippedReferences: number;
  skippedRelationships: number;
  externalSymbols: number;
  warnings: string[];
}

interface ScipDocumentContext {
  document: ScipDocument;
  filePath: string;
  fullPath: string;
  language: Language;
  nodesInFile: GraphNode[];
}

interface DefinitionRecord {
  symbol: string;
  filePath: string;
  language: Language;
  nodeId: string;
  name: string;
  kind: NodeKind;
  occurrence?: ScipOccurrence;
  info: ScipSymbolInformation;
}

interface ScipPlan {
  nodes: GraphNode[];
  edges: Edge[];
  documentsRead: number;
  documentsImported: number;
  referencesImported: number;
  relationshipsImported: number;
  skippedReferences: number;
  skippedRelationships: number;
  externalSymbols: number;
  warnings: string[];
}

interface ScipLanguageResolution {
  language: Language;
  explicitLanguage?: Language;
  indexedLanguage?: Language;
}

const supportedLanguages = new Set<string>(LANGUAGES);

export async function importScipIndex(
  projectRoot: string,
  indexPath: string,
  options: ImportScipOptions = {},
): Promise<ImportScipResult> {
  const root = resolveExistingDirectory(projectRoot, 'project root');
  if (!isInitialized(root)) {
    throw new Error(`OmniWeave not initialized in ${root}`);
  }
  const validation = validateDirectory(root);
  if (!validation.valid) {
    throw new Error(`Invalid OmniWeave directory: ${validation.errors.join(', ')}`);
  }

  const resolvedIndexPath = resolveExistingFile(indexPath, 'SCIP index');
  const index = decodeScipIndexFile(resolvedIndexPath);
  const dbPath = getDatabasePath(root);
  const lock = new FileLock(path.join(getOmniWeaveDir(root), 'omniweave.lock'));

  return await lock.withLockAsync(async () => {
    const conn = DatabaseConnection.open(dbPath);
    try {
      const queries = new QueryBuilder(conn.getDb());
      const plan = buildScipImportPlan(root, index, queries);
      const replacement = options.replace === false
        ? queries.insertScipFacts(plan.nodes, plan.edges)
        : queries.replaceScipFacts(plan.nodes, plan.edges);

      return {
        indexPath: resolvedIndexPath,
        projectRoot: root,
        documentsRead: plan.documentsRead,
        documentsImported: plan.documentsImported,
        nodesImported: replacement.insertedNodes,
        edgesImported: replacement.insertedEdges,
        deletedScipNodes: replacement.deletedNodes,
        deletedScipEdges: replacement.deletedEdges,
        referencesImported: plan.referencesImported,
        relationshipsImported: plan.relationshipsImported,
        skippedReferences: plan.skippedReferences,
        skippedRelationships: plan.skippedRelationships,
        externalSymbols: plan.externalSymbols,
        warnings: plan.warnings,
      };
    } finally {
      conn.close();
    }
  });
}

function buildScipImportPlan(
  projectRoot: string,
  index: ScipIndex,
  queries: QueryBuilder,
): ScipPlan {
  const warnings: string[] = [];
  const contexts = buildDocumentContexts(projectRoot, index.documents, queries, warnings);
  const nodesById = new Map<string, GraphNode>();
  const edgesByKey = new Map<string, Edge>();
  const definitions = new Map<string, DefinitionRecord[]>();
  let skippedReferences = 0;
  let skippedRelationships = 0;
  let referencesImported = 0;
  let relationshipsImported = 0;

  for (const context of contexts) {
    for (const info of context.document.symbols) {
      if (!info.symbol) continue;
      const occurrence = findDefinitionOccurrence(context.document, info.symbol);
      if (occurrence && !hasSupportedOccurrenceRange(occurrence)) {
        warnings.push(malformedRangeWarning(context.filePath, 'definition', occurrence));
        continue;
      }
      const record = createDefinitionRecord(context, info, occurrence, nodesById);
      const records = definitions.get(info.symbol) ?? [];
      records.push(record);
      definitions.set(info.symbol, records);
    }
  }

  for (const context of contexts) {
    for (const occurrence of context.document.occurrences) {
      if (!occurrence.symbol || isDefinitionOccurrence(occurrence)) continue;
      if (!hasSupportedOccurrenceRange(occurrence)) {
        skippedReferences++;
        warnings.push(malformedRangeWarning(context.filePath, 'reference', occurrence));
        continue;
      }
      const target = resolveDefinition(occurrence.symbol, context.language, definitions);
      if (!target) {
        skippedReferences++;
        continue;
      }
      const sourceNode = findEnclosingNode(context.nodesInFile, occurrence, target.nodeId)
        ?? ensureFileNode(context, nodesById);
      const edge = createScipEdge(sourceNode.id, target.nodeId, 'references', occurrence, {
        scipSource: 'occurrence',
        scipTargetSymbol: occurrence.symbol,
      });
      addEdge(edge, edgesByKey);
      referencesImported++;
    }

    for (const info of context.document.symbols) {
      const source = resolveDefinition(info.symbol, context.language, definitions);
      if (!source) continue;
      for (const relationship of info.relationships) {
        const edgeKind = relationshipEdgeKind(relationship);
        if (!edgeKind) {
          skippedRelationships++;
          continue;
        }
        const target = resolveDefinition(relationship.symbol, context.language, definitions);
        if (!target) {
          skippedRelationships++;
          continue;
        }
        const edge = createScipEdge(source.nodeId, target.nodeId, edgeKind, source.occurrence, {
          scipSource: 'relationship',
          scipRelationship: relationshipMetadata(relationship),
          scipSourceSymbol: info.symbol,
          scipTargetSymbol: relationship.symbol,
        });
        addEdge(edge, edgesByKey);
        relationshipsImported++;
      }
    }
  }

  return {
    nodes: [...nodesById.values()],
    edges: [...edgesByKey.values()],
    documentsRead: index.documents.length,
    documentsImported: contexts.length,
    referencesImported,
    relationshipsImported,
    skippedReferences,
    skippedRelationships,
    externalSymbols: index.externalSymbols.length,
    warnings,
  };
}

function buildDocumentContexts(
  projectRoot: string,
  documents: ScipDocument[],
  queries: QueryBuilder,
  warnings: string[],
): ScipDocumentContext[] {
  const contexts: ScipDocumentContext[] = [];

  for (const document of documents) {
    const filePath = normalizeScipRelativePath(document.relativePath);
    const fullPath = filePath ? validatePathWithinRoot(projectRoot, filePath) : null;
    if (!filePath || !fullPath) {
      throw new Error(`Invalid SCIP document path: ${document.relativePath || '(empty)'}`);
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      warnings.push(`Skipping SCIP document with missing source file: ${filePath}`);
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(`SCIP document path is not a regular file: ${filePath}`);
    }
    const indexedFile = queries.getFileByPath(filePath);
    if (!indexedFile) {
      warnings.push(`Skipping SCIP document outside OmniWeave index: ${filePath}`);
      continue;
    }
    if (document.text && fs.readFileSync(fullPath, 'utf8') !== document.text) {
      warnings.push(`Skipping SCIP document with stale embedded text: ${filePath}`);
      continue;
    }
    const nodesInFile = queries.getNodesByFile(filePath).filter((node) => !node.id.startsWith('scip:'));
    const language = resolveScipDocumentLanguage(document.language, indexedFile.language);
    if (language.language === 'unknown') {
      warnings.push(`Skipping SCIP document with unsupported language "${document.language || 'unknown'}": ${filePath}`);
      continue;
    }
    if (
      language.explicitLanguage &&
      language.indexedLanguage &&
      !compatibleDocumentLanguage(language.explicitLanguage, language.indexedLanguage)
    ) {
      warnings.push(
        `Skipping SCIP document with language mismatch: ${filePath} (SCIP ${language.explicitLanguage}, indexed ${language.indexedLanguage})`
      );
      continue;
    }

    contexts.push({
      document,
      filePath,
      fullPath,
      language: language.indexedLanguage ?? language.language,
      nodesInFile,
    });
  }

  return contexts;
}

function createDefinitionRecord(
  context: ScipDocumentContext,
  info: ScipSymbolInformation,
  occurrence: ScipOccurrence | undefined,
  nodesById: Map<string, GraphNode>,
): DefinitionRecord {
  const name = info.displayName || displayNameFromSymbol(info.symbol);
  const kind = scipKindToNodeKind(info.kind);
  const existing = findMatchingDefinitionNode(context.nodesInFile, name, kind, occurrence);
  const nodeId = existing?.id ?? scipNodeId(info.symbol, context.filePath);

  if (!existing && !nodesById.has(nodeId)) {
    nodesById.set(nodeId, createScipDefinitionNode(context, info, occurrence, nodeId, name, kind));
  }

  return {
    symbol: info.symbol,
    filePath: context.filePath,
    language: context.language,
    nodeId,
    name,
    kind,
    occurrence,
    info,
  };
}

function createScipDefinitionNode(
  context: ScipDocumentContext,
  info: ScipSymbolInformation,
  occurrence: ScipOccurrence | undefined,
  id: string,
  name: string,
  kind: NodeKind,
): GraphNode {
  const range = occurrenceRange(occurrence);
  const signature = info.signature?.text || undefined;
  return {
    id,
    kind,
    name,
    qualifiedName: info.symbol,
    filePath: context.filePath,
    language: context.language,
    startLine: range.startLine,
    endLine: range.endLine,
    startColumn: range.startColumn,
    endColumn: range.endColumn,
    docstring: info.documentation[0],
    signature,
    updatedAt: Date.now(),
  };
}

function ensureFileNode(context: ScipDocumentContext, nodesById: Map<string, GraphNode>): GraphNode {
  const existing = context.nodesInFile.find((node) => node.kind === 'file');
  if (existing) return existing;

  const id = scipNodeId(`file:${context.filePath}`, context.filePath);
  const current = nodesById.get(id);
  if (current) return current;

  const node: GraphNode = {
    id,
    kind: 'file',
    name: path.basename(context.filePath),
    qualifiedName: context.filePath,
    filePath: context.filePath,
    language: context.language,
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  };
  nodesById.set(id, node);
  return node;
}

function findMatchingDefinitionNode(
  nodes: GraphNode[],
  name: string,
  kind: NodeKind,
  occurrence: ScipOccurrence | undefined,
): GraphNode | null {
  const sameName = nodes.filter((node) => node.name === name && compatibleNodeKind(node.kind, kind));
  if (sameName.length === 0) return null;

  const range = occurrenceRange(occurrence);
  const containing = sameName.filter((node) => node.startLine <= range.startLine && node.endLine >= range.startLine);
  if (containing.length === 1) return containing[0]!;
  if (containing.length > 1) return smallestRangeNode(containing);
  if (sameName.length === 1 && !occurrence) return sameName[0]!;
  return null;
}

function findEnclosingNode(
  nodes: GraphNode[],
  occurrence: ScipOccurrence,
  targetNodeId: string,
): GraphNode | null {
  const range = occurrenceRange(occurrence);
  const candidates = nodes
    .filter((node) => node.id !== targetNodeId)
    .filter((node) => node.kind !== 'file')
    .filter((node) => node.startLine <= range.startLine && node.endLine >= range.startLine);
  if (candidates.length === 0) return null;
  return smallestRangeNode(candidates);
}

function smallestRangeNode(nodes: GraphNode[]): GraphNode {
  return [...nodes].sort((a, b) => {
    const aSpan = Math.max(0, a.endLine - a.startLine);
    const bSpan = Math.max(0, b.endLine - b.startLine);
    return aSpan - bSpan || a.startColumn - b.startColumn;
  })[0]!;
}

function resolveDefinition(
  symbol: string,
  language: Language,
  definitions: Map<string, DefinitionRecord[]>,
): DefinitionRecord | null {
  const candidates = (definitions.get(symbol) ?? []).filter((record) => record.language === language);
  return candidates.length === 1 ? candidates[0]! : null;
}

function findDefinitionOccurrence(document: ScipDocument, symbol: string): ScipOccurrence | undefined {
  return document.occurrences.find(
    (occurrence) => occurrence.symbol === symbol && isDefinitionOccurrence(occurrence)
  );
}

function isDefinitionOccurrence(occurrence: ScipOccurrence): boolean {
  return (occurrence.symbolRoles & SCIP_SYMBOL_ROLE_DEFINITION) !== 0 ||
    (occurrence.symbolRoles & SCIP_SYMBOL_ROLE_FORWARD_DEFINITION) !== 0;
}

function hasSupportedOccurrenceRange(occurrence: ScipOccurrence | undefined): boolean {
  if (!occurrence) return true;
  return occurrence.range.length === 0 || occurrence.range.length === 3 || occurrence.range.length === 4;
}

function malformedRangeWarning(filePath: string, role: 'definition' | 'reference', occurrence: ScipOccurrence): string {
  return `Skipping SCIP ${role} with malformed range (${occurrence.range.length} values): ${filePath} ${occurrence.symbol}`;
}

function createScipEdge(
  source: string,
  target: string,
  kind: EdgeKind,
  occurrence: ScipOccurrence | undefined,
  metadata: Record<string, unknown>,
): Edge {
  const range = occurrenceRange(occurrence);
  return {
    source,
    target,
    kind,
    line: range.startLine,
    column: range.startColumn,
    provenance: 'scip',
    metadata,
  };
}

function addEdge(edge: Edge, edgesByKey: Map<string, Edge>): void {
  const key = `${edge.source}\0${edge.target}\0${edge.kind}\0${edge.line ?? 0}\0${edge.column ?? 0}\0${semanticEdgeMetadataKey(edge.metadata)}`;
  edgesByKey.set(key, edge);
}

function semanticEdgeMetadataKey(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return '';
  return JSON.stringify({
    scipSource: metadata.scipSource,
    scipRelationship: metadata.scipRelationship,
    scipSourceSymbol: metadata.scipSourceSymbol,
    scipTargetSymbol: metadata.scipTargetSymbol,
  });
}

function relationshipEdgeKind(relationship: ScipRelationship): EdgeKind | null {
  if (relationship.isImplementation) return 'implements';
  if (relationship.isTypeDefinition) return 'type_of';
  if (relationship.isDefinition || relationship.isReference) return 'references';
  return null;
}

function relationshipMetadata(relationship: ScipRelationship): string[] {
  const flags: string[] = [];
  if (relationship.isReference) flags.push('reference');
  if (relationship.isImplementation) flags.push('implementation');
  if (relationship.isTypeDefinition) flags.push('type_definition');
  if (relationship.isDefinition) flags.push('definition');
  return flags;
}

function occurrenceRange(occurrence: ScipOccurrence | undefined): {
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
} {
  if (!occurrence || occurrence.range.length === 0) {
    return { startLine: 1, endLine: 1, startColumn: 0, endColumn: 0 };
  }
  if (occurrence.range.length === 3) {
    return {
      startLine: occurrence.range[0]! + 1,
      endLine: occurrence.range[0]! + 1,
      startColumn: occurrence.range[1]!,
      endColumn: occurrence.range[2]!,
    };
  }
  return {
    startLine: occurrence.range[0]! + 1,
    endLine: occurrence.range[2]! + 1,
    startColumn: occurrence.range[1]!,
    endColumn: occurrence.range[3]!,
  };
}

function scipKindToNodeKind(kind: number): NodeKind {
  switch (kind) {
    case 7:
      return 'class';
    case 21:
      return 'interface';
    case 49:
      return 'struct';
    case 53:
      return 'trait';
    case 11:
      return 'enum';
    case 12:
      return 'enum_member';
    case 55:
      return 'type_alias';
    case 15:
      return 'field';
    case 41:
    case 81:
      return 'property';
    case 8:
      return 'constant';
    case 37:
      return 'parameter';
    case 61:
    case 82:
      return 'variable';
    case 26:
    case 66:
    case 67:
    case 68:
    case 69:
    case 70:
    case 71:
    case 80:
    case 9:
    case 18:
    case 45:
      return 'method';
    case 29:
      return 'module';
    case 30:
      return 'namespace';
    case 17:
    default:
      return 'function';
  }
}

function compatibleNodeKind(actual: NodeKind, expected: NodeKind): boolean {
  if (actual === expected) return true;
  const callable = new Set<NodeKind>(['function', 'method']);
  const typeLike = new Set<NodeKind>(['class', 'interface', 'struct', 'trait', 'type_alias']);
  return (callable.has(actual) && callable.has(expected)) || (typeLike.has(actual) && typeLike.has(expected));
}

function normalizeScipLanguage(language: string): Language {
  const normalized = language.trim().toLowerCase().replace(/[-_ ]react$/, '');
  const aliases: Record<string, Language> = {
    js: 'javascript',
    javascriptreact: 'jsx',
    ts: 'typescript',
    typescriptreact: 'tsx',
    py: 'python',
    golang: 'go',
    objective_c: 'objc',
    objectivec: 'objc',
    cplusplus: 'cpp',
    'c++': 'cpp',
    csharp: 'csharp',
    'c#': 'csharp',
  };
  const candidate = aliases[normalized] ?? normalized;
  return supportedLanguages.has(candidate) ? candidate as Language : 'unknown';
}

function resolveScipDocumentLanguage(
  rawLanguage: string,
  indexedLanguage: Language,
): ScipLanguageResolution {
  if (rawLanguage.trim()) {
    const explicitLanguage = normalizeScipLanguage(rawLanguage);
    return {
      language: explicitLanguage,
      explicitLanguage,
      indexedLanguage,
    };
  }

  return { language: indexedLanguage, indexedLanguage };
}

function compatibleDocumentLanguage(scipLanguage: Language, indexedLanguage: Language): boolean {
  if (scipLanguage === indexedLanguage) return true;
  return sameLanguageFamily(scipLanguage, indexedLanguage, 'typescript', 'tsx') ||
    sameLanguageFamily(scipLanguage, indexedLanguage, 'javascript', 'jsx');
}

function sameLanguageFamily(a: Language, b: Language, first: Language, second: Language): boolean {
  return (a === first || a === second) && (b === first || b === second);
}

function normalizeScipRelativePath(relativePath: string): string | null {
  if (!relativePath || relativePath.startsWith('/') || relativePath.includes('\\')) return null;
  const parts = relativePath.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null;
  return parts.join('/');
}

function displayNameFromSymbol(symbol: string): string {
  if (symbol.startsWith('local ')) return symbol.slice('local '.length);
  const stripped = symbol.trim().replace(/[.#:!]+$/g, '').replace(/\([^)]*\)\.?$/g, '');
  const match = stripped.match(/`([^`]+)`$|([A-Za-z0-9_$+-]+)$/);
  return (match?.[1] || match?.[2] || symbol).replace(/``/g, '`');
}

function scipNodeId(symbol: string, filePath: string): string {
  return `scip:${crypto.createHash('sha256').update(symbol).update('\0').update(filePath).digest('hex')}`;
}

function resolveExistingDirectory(dir: string, label: string): string {
  const resolved = path.resolve(dir);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`${label} does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${resolved}`);
  }
  return fs.realpathSync(resolved);
}

function resolveExistingFile(filePath: string, label: string): string {
  const resolved = path.resolve(filePath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`${label} does not exist: ${resolved}`);
  }
  if (!stat.isFile()) {
    throw new Error(`${label} is not a file: ${resolved}`);
  }
  return fs.realpathSync(resolved);
}
