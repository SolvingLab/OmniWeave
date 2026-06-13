import type { EvalTestCase } from './types.js';

export const testCases: EvalTestCase[] = [
  // === searchNodes: Symbol Lookup Precision ===

  {
    id: 'search-class-exact',
    query: 'TransportService',
    api: 'searchNodes',
    expectedSymbols: ['TransportService'],
    kinds: ['class'],
  },
  {
    id: 'search-method-qualified',
    query: 'TransportService sendRequest',
    api: 'searchNodes',
    expectedSymbols: ['sendRequest'],
    kinds: ['method'],
  },
  {
    id: 'search-interface',
    query: 'ActionListener',
    api: 'searchNodes',
    expectedSymbols: ['ActionListener'],
    kinds: ['interface'],
  },
  {
    id: 'search-enum',
    query: 'RestStatus',
    api: 'searchNodes',
    expectedSymbols: ['RestStatus'],
    kinds: ['enum'],
  },
  {
    id: 'search-exception',
    query: 'SearchPhaseExecutionException',
    api: 'searchNodes',
    expectedSymbols: ['SearchPhaseExecutionException'],
    kinds: ['class'],
  },
  {
    id: 'search-nested-class',
    query: 'Engine Index',
    api: 'searchNodes',
    expectedSymbols: ['Index'],
    kinds: ['class'],
  },

  // === findRelevantContext: Exploration Quality ===

  {
    id: 'explore-rest-layer',
    query: 'How does the REST layer handle HTTP requests?',
    api: 'findRelevantContext',
    expectedSymbols: ['RestController', 'RestHandler', 'BaseRestHandler', 'RestRequest'],
    options: { searchLimit: 8, traversalDepth: 3, maxNodes: 80, minScore: 0.2 },
  },
  {
    id: 'explore-search-execution',
    query: 'How does search execution work from request to shard?',
    api: 'findRelevantContext',
    expectedSymbols: ['ShardSearchRequest', 'SearchShardsRequest', 'SearchShardsGroup'],
    options: { searchLimit: 8, traversalDepth: 3, maxNodes: 80, minScore: 0.2 },
  },
  {
    id: 'explore-bulk-indexing',
    query: 'How does bulk indexing work?',
    api: 'findRelevantContext',
    expectedSymbols: ['TransportBulkAction', 'BulkRequest', 'BulkResponse'],
    options: { searchLimit: 8, traversalDepth: 3, maxNodes: 80, minScore: 0.2 },
  },
  {
    id: 'explore-shard-allocation',
    query: 'How does shard rebalancing and allocation work?',
    api: 'findRelevantContext',
    expectedSymbols: ['AllocationService', 'BalancedShardsAllocator'],
    options: { searchLimit: 8, traversalDepth: 3, maxNodes: 80, minScore: 0.2 },
  },
  {
    id: 'explore-transport-search',
    query: 'How does TransportService connect to SearchTransportService?',
    api: 'findRelevantContext',
    expectedSymbols: ['TransportService', 'SearchTransportService'],
    options: { searchLimit: 8, traversalDepth: 3, maxNodes: 80, minScore: 0.2 },
  },
  {
    id: 'explore-engine-implementations',
    query: 'What are the Engine implementations for indexing?',
    api: 'findRelevantContext',
    expectedSymbols: ['InternalEngine', 'ReadOnlyEngine', 'Engine'],
    options: { searchLimit: 8, traversalDepth: 3, maxNodes: 80, minScore: 0.2 },
  },

  // === assertEdges: R S4 dispatch graph (corpus: DESeq2) ===
  // These are the Phase 1·A gate. At baseline both are 0 (setMethod extracts as
  // an isolated `function`, unlinked to class or generic). They go green once the
  // R extractor encodes the dispatch class into the method's qualifiedName and the
  // resolver synthesizes the class→method `contains` / method→generic `overrides`
  // edges. Index with: EVAL_CORPUS=deseq2 against a DESeq2 checkout.
  {
    // DESeqDataSet has ~10+ setMethod dispatch targets across methods.R/plots.R
    // (counts, design, dispersions, sizeFactors, … plus their `<-` replacement
    // forms). Threshold 8 sits safely above 0 and below the true count.
    id: 'r-s4-contains-deseqdataset',
    query: 'S4 methods that dispatch on the DESeqDataSet class',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'deseq2',
    symbolName: 'DESeqDataSet',
    edgeKind: 'contains',
    direction: 'outgoing',
    minEdgeCount: 8,
  },
  {
    // `dispersions` is declared locally via setGeneric (AllGenerics.R), so the
    // DESeqDataSet setMethod that specializes it produces a method→generic
    // `overrides` edge — the generic node gains an incoming override. (Generics
    // imported from BiocGenerics have no local node, hence no edge — by design.)
    id: 'r-s4-overrides-dispersions',
    query: 'S4 methods specializing the locally-declared dispersions generic',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'deseq2',
    symbolName: 'dispersions',
    edgeKind: 'overrides',
    direction: 'incoming',
    minEdgeCount: 1,
  },

  // === assertEdges: cross-process workflow dataflow (corpus: workflow) ===
  // Phase 1·B gate. Baseline 0 (no workflow extraction): a workflow step shells
  // out to an R/Python script across a process boundary the call graph can't
  // follow. Green once the workflow resolver emits step nodes and the crossLang
  // synthesizer wires step → script file. Index a workflow checkout with
  // EVAL_CORPUS=workflow.
  {
    // Snakemake `rule deseq2:` has `script: "scripts/deseq2.R"` → crossLang edge.
    id: 'workflow-crosslang-snakemake',
    query: 'Snakemake rule that runs an R analysis script',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'workflow',
    symbolName: 'deseq2',
    edgeKind: 'crossLang',
    direction: 'outgoing',
    minEdgeCount: 1,
  },
  {
    // Nextflow `process DESEQ2_DIFFERENTIAL` shells `Rscript .../bin/deseq.R`.
    id: 'workflow-crosslang-nextflow',
    query: 'Nextflow process invoking an R script across the process boundary',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'workflow',
    symbolName: 'DESEQ2_DIFFERENTIAL',
    edgeKind: 'crossLang',
    direction: 'outgoing',
    minEdgeCount: 1,
  },
  {
    // `rule align:` has `output: bam="aligned/{sample}.bam"` → a produces edge.
    id: 'workflow-produces-align',
    query: 'Snakemake rule that writes a data artifact',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'workflow',
    symbolName: 'align',
    edgeKind: 'produces',
    direction: 'outgoing',
    minEdgeCount: 1,
  },
  {
    // The DAG link: `align` produces `aligned/{sample}.bam` and `deseq2` consumes
    // it (`input: expand("aligned/{sample}.bam", ...)`). Both resolve to the ONE
    // path-keyed artifact node, so that node has an incoming `consumes` from
    // deseq2 — proving the cross-rule pipeline edge, not just per-rule I/O.
    id: 'workflow-dag-link',
    query: 'data artifact that connects the align step to the downstream deseq2 step',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'workflow',
    symbolName: 'aligned/{sample}.bam',
    edgeKind: 'consumes',
    direction: 'incoming',
    minEdgeCount: 1,
  },

  // === capstone: end-to-end polyglot chain (corpus: capstone) ===
  // The Phase 2 gate. Corpus __tests__/fixtures/capstone is a self-contained
  // pipeline: a Snakemake `rule fit_model:` whose `script: "scripts/model.R"`
  // crosses the process boundary into an R file that DEFINES its own S4 class +
  // generic + method. So both Phase 1 tracks light up in ONE corpus and — the
  // point of this gate — COMPOSE: workflow step → (crossLang) → R file →
  // (contains/calls) → S4 method → (overrides) → generic. That single navigable
  // chain across a process boundary, a language boundary, and a dynamic dispatch
  // is the §1.5 differentiator (the zone LSP cannot reach).
  // Index + run:
  //   cd __tests__/fixtures/capstone && node <repo>/dist/bin/codegraph.js init -i
  //   EVAL_CORPUS=capstone npm run eval __tests__/fixtures/capstone

  // --- per-hop diagnostic layer: pinpoints WHICH extractor regressed ---
  {
    // Track B: the workflow rule emits a crossLang edge to its R script. Red if
    // the workflow resolver stops recognizing `script:` or the rule name shifts.
    id: 'capstone-crosslang-fit-model',
    query: 'Snakemake rule fit_model invokes an R script across the process boundary',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'capstone',
    symbolName: 'fit_model',
    edgeKind: 'crossLang',
    direction: 'outgoing',
    minEdgeCount: 1,
  },
  {
    // Track A: the GeneModel S4 class owns its dispatched methods (fit,
    // predict_expr) via synthesized class→method `contains`. Red if setMethod
    // extraction or the S4 dispatch synthesizer regresses.
    id: 'capstone-s4-genemodel-contains',
    query: 'GeneModel S4 class contains its dispatched methods',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'capstone',
    symbolName: 'GeneModel',
    edgeKind: 'contains',
    direction: 'outgoing',
    minEdgeCount: 2,
  },
  {
    // Track A: the fit method overrides its locally-declared setGeneric generic.
    id: 'capstone-s4-fit-overrides',
    query: 'S4 fit method overrides the locally-declared fit generic',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'capstone',
    symbolName: 'fit',
    edgeKind: 'overrides',
    direction: 'incoming',
    minEdgeCount: 1,
  },

  {
    // Track B, second engine: a Nextflow process whose script block is a
    // `template 'predict.R'` directive emits a crossLang edge to the templates/
    // script. This is the dominant cross-language mechanism in nf-core DSL2
    // modules; at baseline it was 0 (the synthesizer only knew Snakemake
    // `script:` and shell invocations), so this case both proves the engine
    // coverage and guards the template path from regressing.
    id: 'capstone-nextflow-template-crosslang',
    query: 'Nextflow process that runs an R template script across the process boundary',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'capstone',
    symbolName: 'PREDICT',
    edgeKind: 'crossLang',
    direction: 'outgoing',
    minEdgeCount: 1,
  },

  // --- composition gate: the only case that proves the chain CONNECTS ---
  {
    // The §1.5 differentiator as one navigable path: from the workflow step
    // fit_model, reach the S4 dispatch target method `fit` (qualifiedName
    // GeneModel::fit) within 4 hops, following only the polyglot edge set. The
    // real chain is 2 hops (fit_model --crossLang--> model.R --calls/contains-->
    // fit method); the 4-hop budget tolerates a future intermediate without
    // going green on nonsense. `toKind: 'method'` is load-bearing: without it
    // the same-named generic `fit` (function) would satisfy reachability even if
    // the S4 method node regressed away, so the gate would pass while the
    // dispatch graph is dead. This case CANNOT be reduced to per-hop assertEdges:
    // those stay green even if crossLang lands in a different file than the one
    // owning the S4 class. Only a shared-node path assertion catches that.
    id: 'capstone-e2e-polyglot-chain',
    query: 'end-to-end: workflow step reaches the S4 dispatch method across the crossLang boundary',
    api: 'assertReachable',
    expectedSymbols: [],
    corpus: 'capstone',
    fromName: 'fit_model',
    toName: 'fit',
    toKind: 'method',
    maxHops: 4,
    reachableVia: ['crossLang', 'calls', 'contains', 'overrides'],
  },

  // --- S4 generic-call routing: a bare `fit(model)` call invokes the GENERIC ---
  // `fit(model)` in R calls the S4 generic `fit`, which dispatches on the object's
  // class at RUNTIME. Statically the call targets the generic; picking one dispatched
  // method is a false-precision proximity guess (and which method runs is runtime-
  // undecidable — the honesty ceiling). The dispatch candidates stay reachable via the
  // method→generic `overrides` edges. A real-corpus probe (DESeq2) showed these calls
  // resolving inconsistently — mostly to the generic at low confidence 0.4, sometimes
  // misfiring onto a method. These two gates lock the §1.5-pure resolution: the call
  // lands on the generic (function), never on the method node.
  {
    // The S4 generic call must resolve to the GENERIC (function qn === name).
    id: 'capstone-s4-generic-call-to-generic',
    query: 'A bare S4 generic call fit(model) resolves to the generic, not a method',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'capstone',
    symbolName: 'fit',
    symbolKind: 'function',
    edgeKind: 'calls',
    direction: 'incoming',
    minEdgeCount: 1,
  },
  {
    // PRECISION (teeth): the call must NOT misfire onto the dispatched METHOD —
    // that is a false-precision guess at which runtime dispatch target is hit.
    id: 'capstone-s4-generic-call-not-method',
    query: 'A bare S4 generic call must not resolve to a specific dispatched method',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'capstone',
    symbolName: 'fit',
    symbolKind: 'method',
    edgeKind: 'calls',
    direction: 'incoming',
    minEdgeCount: 0,
    maxEdgeCount: 0,
  },
  {
    // R class + same-named constructor function (the idiomatic Bioconductor pattern,
    // cf. DESeq2's `DESeqDataSet()`): a bare `GeneModel(counts)` call invokes the
    // CONSTRUCTOR FUNCTION (R classes are not directly callable). The target was already
    // correct via findBestMatch's function-preference, but pinned at the proximity floor
    // 0.4 — an agent distrusts a correct-but-under-confident edge. The bare-call router
    // lifts it to 0.9. `minConfidence` gives this calibration fix teeth: without the
    // router the same gate is RED (the only edge is at 0.4 < 0.9).
    id: 'capstone-r-constructor-call-high-confidence',
    query: 'A bare R constructor call GeneModel(counts) resolves to the constructor at high confidence',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'capstone',
    symbolName: 'GeneModel',
    symbolKind: 'function',
    edgeKind: 'calls',
    direction: 'incoming',
    minEdgeCount: 1,
    minConfidence: 0.9,
  },

  // --- invokes: workflow step → external command-line tool ------------------
  // crossLang wires a step to a LOCAL script (.R/.py); it does NOT cover the external
  // BINARIES a pipeline runs (bwa, samtools, STAR) — a separate process with no repo
  // source, the exact cross-process hop LSP can't follow. `invokes` closes that gap.
  // The snakemake-wrapper path `bio/<tool>/<sub>` names the tool with no shell to
  // parse, so the edge is high-precision. Baseline 0 (no tool extraction).
  {
    // callees(star_align) reaches the external tool it runs.
    id: 'capstone-invokes-tool-from-step',
    query: 'What external tool does the Snakemake rule star_align run?',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'capstone',
    symbolName: 'star_align',
    edgeKind: 'invokes',
    direction: 'outgoing',
    minEdgeCount: 1,
  },
  {
    // callers(star) lists EVERY step that runs STAR — the shared name-keyed tool node
    // aggregates pipeline-wide usage (star_index + star_align both invoke it).
    id: 'capstone-tool-callers-aggregate',
    query: 'Which pipeline steps run the STAR tool?',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'capstone',
    symbolName: 'star',
    symbolKind: 'tool',
    edgeKind: 'invokes',
    direction: 'incoming',
    minEdgeCount: 2,
  },

  // === general crossLang: any-file cross-process calls (corpus: polyglot-subprocess) ===
  // Phase 3' gate. crossLang used to be gated to workflow files (Snakemake/Nextflow);
  // here a PLAIN Python module shells out to an R/Python script and a JS build script
  // shells out to Python — the cross-process, cross-language hop that LSP can't follow,
  // now in ordinary code, not just bioinformatics pipelines. Baseline 0 (the synthesizer
  // early-returned unless the repo had a workflow file). Green once generalCrossLangEdges
  // attributes a crossLang edge from the CALLING function to the target script.
  // Index + run:
  //   cd __tests__/fixtures/polyglot-subprocess && node <repo>/dist/bin/codegraph.js init -i
  //   EVAL_CORPUS=polyglot-subprocess npm run eval __tests__/fixtures/polyglot-subprocess
  {
    // Modern array form: subprocess.run(["Rscript", "scripts/deseq.R", ...]).
    id: 'general-crosslang-py-subprocess',
    query: 'Python function that runs an R script via subprocess.run',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'polyglot-subprocess',
    symbolName: 'run_analysis',
    edgeKind: 'crossLang',
    direction: 'outgoing',
    minEdgeCount: 1,
  },
  {
    // Flat-string form: os.system("python scripts/report.py ...").
    id: 'general-crosslang-py-ossystem',
    query: 'Python function that runs another Python script via os.system',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'polyglot-subprocess',
    symbolName: 'make_report',
    edgeKind: 'crossLang',
    direction: 'outgoing',
    minEdgeCount: 1,
  },
  {
    // Multi-language proof: a JS function via child_process.execFile -> Python.
    id: 'general-crosslang-js-childprocess',
    query: 'JavaScript build function that runs a Python script via child_process',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'polyglot-subprocess',
    symbolName: 'buildReport',
    edgeKind: 'crossLang',
    direction: 'outgoing',
    minEdgeCount: 1,
  },
  {
    // 'This directory' interpolated-prefix, ARRAY form: subprocess.run(["python3",
    // f"{sys.path[0]}/tool_sub.py"]). This is the dominant real-world Python-CLI
    // dispatcher idiom (quarTeT: 5/5 of its real subprocess->script edges look
    // exactly like this). Pre-fix recall was 0 — the f-string prefix broke the
    // array regex. Green once a leading '{...}/' interpolation is recognized as a
    // this-repo directory and the static basename resolves to the real sibling.
    id: 'general-crosslang-fstring-array',
    query: 'Python dispatcher that runs a sibling script via an f-string this-dir path',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'polyglot-subprocess',
    symbolName: 'dispatch_array',
    edgeKind: 'crossLang',
    direction: 'outgoing',
    minEdgeCount: 1,
  },
  {
    // 'This directory' interpolated-prefix, FLAT-STRING form:
    // subprocess.run(f"python3 {os.path.dirname(__file__)}/tool_sub.py ...").
    id: 'general-crosslang-fstring-string',
    query: 'Python dispatcher that runs a sibling script via an f-string __file__ dir',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'polyglot-subprocess',
    symbolName: 'dispatch_string',
    edgeKind: 'crossLang',
    direction: 'outgoing',
    minEdgeCount: 1,
  },
  {
    // Recall (API coverage): subprocess.check_call array form. An adversarial probe
    // found `check_call` missing from the recognized call set (`call` doesn't match
    // `check_call`), so a ubiquitous API minted no edge. Red before that fix.
    id: 'general-crosslang-check-call',
    query: 'Python function that runs a script via subprocess.check_call',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'polyglot-subprocess',
    symbolName: 'run_via_check_call',
    edgeKind: 'crossLang',
    direction: 'outgoing',
    minEdgeCount: 1,
  },
  {
    // Recall (API coverage): Node child_process.execFileSync. The `…Sync` variants
    // need `execFile` tried before `exec` so `execFileSync` resolves to execFile+Sync
    // rather than getting stuck on `exec`. An adversarial probe caught this miss.
    id: 'general-crosslang-execfilesync',
    query: 'JS build function that runs a script via child_process.execFileSync',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'polyglot-subprocess',
    symbolName: 'buildReportSync',
    edgeKind: 'crossLang',
    direction: 'outgoing',
    minEdgeCount: 1,
  },
  {
    // PRECISION NEGATIVE (teeth): `os.system("echo Rscript scripts/deseq.R …")` only
    // echoes the command — the interpreter is an argument to echo, not the invoked
    // process. Must mint ZERO crossLang edges. Without maxEdgeCount this case has no
    // teeth; an over-linking synthesizer would still pass every positive gate.
    id: 'general-crosslang-echo-negative',
    query: 'Python function that only echoes an interpreter+path string (must not edge)',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'polyglot-subprocess',
    symbolName: 'echo_not_run',
    edgeKind: 'crossLang',
    direction: 'outgoing',
    minEdgeCount: 0,
    maxEdgeCount: 0,
  },
  {
    // PRECISION NEGATIVE (teeth): a real subprocess call followed by a bare string
    // naming an interpreter+path must NOT borrow the earlier call's token (look-back
    // bounded at the closing `)`). Must mint ZERO crossLang edges.
    id: 'general-crosslang-straddle-negative',
    query: 'Bare interpreter+path string after an unrelated subprocess call (must not edge)',
    api: 'assertEdges',
    expectedSymbols: [],
    corpus: 'polyglot-subprocess',
    symbolName: 'straddle_negative',
    edgeKind: 'crossLang',
    direction: 'outgoing',
    minEdgeCount: 0,
    maxEdgeCount: 0,
  },
];
