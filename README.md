<div align="center">

# OmniWeave

### A high-performance, polyglot **code-analysis graph** for coding agents

**Weave a whole repository — across languages, across processes — into one navigable graph.**

The relationships that matter most to an agent are exactly the ones a language server and `grep` can't follow: a Python orchestrator that shells out to an R script, a Snakemake rule that runs an external binary, an S4 method dispatched at runtime. OmniWeave makes those hops **first-class, typed, traversable edges** — answered in a single sub-millisecond query.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Local](https://img.shields.io/badge/100%25-local-brightgreen.svg)](#performance)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-blue.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-native-blueviolet.svg)](#use-it-from-an-agent)
[![Tests](https://img.shields.io/badge/tests-1490%20passing-success.svg)](#engineering)
[![Agent A/B](https://img.shields.io/badge/agent_A%2FB-measured-orange.svg)](#does-an-agent-actually-do-better-with-omniweave)

</div>

---

## Why OmniWeave

A coding agent already has `grep` and an LSP. OmniWeave earns its place by winning *exactly where they stop*:

- **Cross-language.** An LSP is scoped to one language. OmniWeave links a `.smk` rule, a `.nf` process, or a plain Python function to the **R / Python / Perl script it runs across the process boundary** — and on into that script's functions and methods.
- **Cross-process.** A subprocess argument is opaque to a language server. OmniWeave resolves `subprocess.run([...])`, `os.system(...)`, `child_process.*`, `exec.Command`, and workflow directives into a real edge you can traverse both ways.
- **Dynamic dispatch.** Runtime dispatch is invisible to static call graphs. OmniWeave models R's S4 `setGeneric`/`setMethod` as a dispatch graph (class → method → generic) and routes a bare generic call to the right entry point.
- **Token economy.** One typed, traversable answer instead of a dozen `grep` passes the agent has to re-parse. The graph is built **by relationship**, not padded by language count.

> **Honest by construction.** Every inferred edge carries a `provenance` and a `confidence`. What can't be known statically — a runtime-built path, NSE, runtime dispatch — is *skipped, never guessed*. The agent is never handed a fabricated edge it might trust.

---

## Does an agent actually do better with OmniWeave?

Not a claim — a measurement. An A/B benchmark across **4 rounds, 8 real repositories, ~60 headless runs**, 5 languages (R · Python · TS · Java · polyglot), 2 models (Claude Sonnet + Haiku), identical prompts. The *only* variable is whether OmniWeave's MCP graph is attached; both arms keep the same built-in `grep` / `read` / `bash`. Tool-calls are the reliable effort signal (token cost is prompt-cache-sensitive); both are reported.

| Query · repo | Correct? | Tool calls *(with / without)* | Cost |
|---|---|---|---|
| Single-point lookup · small repos (≤ 450 files) | tie | **17 / 31** (−45%) | ≈ tie |
| Reverse / multi-hop · small repos | tie | **16 / 34** (−53%) | −16% |
| **Reverse blast-radius · django** (3,005 files) | **tie** | **2 / 31** (−94%) | **−64%** |
| **Reverse blast-radius · vscode** (11,538 files) | **tie** | **2 / 47** (−96%) | **−76%** |
| Structurally-ungreppable · dispatch trap / cross-process / deep transitive | **tie** | varies (see below) | varies |

On vscode, the plain `grep` / `read` agent reached the **same correct answer** — but spent **47 tool calls, 1.13 M input tokens, and ~6 minutes** brute-force-reading files to map every call site back to its enclosing function. With OmniWeave: **2 calls, 95 K tokens, 77 seconds** — one structural query instead of a file-by-file sweep. **The bigger the repo, the more `grep`'s read budget explodes; OmniWeave stays O(1).**

**What this honestly shows — including where it *doesn't* win.** Correctness was a **tie in every tier, and we went looking for where it wouldn't be.** Round 4 built deliberately structurally-ungreppable questions — a Java virtual-dispatch *trap* (`Ordering.natural().reverse()`, where the naive read gives the wrong class), a cross-process subprocess chain, a 4-hop transitive blast radius — across Java/Python/polyglot and **both Sonnet and Haiku, 3 runs each**. Correctness still **tied** (e.g. the dispatch trap: 12/12 correct, both arms, both models): a capable agent *reads and verifies* its way to the right answer, and OmniWeave's own static edges hit the same honest ceiling (they route to a declaration, not a runtime-dispatch target). **OmniWeave's moat is effort / tokens / latency / cost — and it widens with repo size *and* as the model gets weaker** (on the dispatch trap, Haiku-without-OmniWeave burned **13 tool calls vs OmniWeave's 2**; Sonnet-without was 7–9). Versus real competitors, not just grep: OmniWeave **ties an LSP** (`typescript-language-server`) on same-language navigation, but wins where LSP is blind — a **zero-config Python checkout** (pyright resolves 0 of 17 callers without an installed env), cross-language, cross-process, and R/S4 dispatch; **Aider's repo-map** is a ranked context list with no traversable edges, so it can't answer these at all. *(The A/B harness is under [`scripts/agent-eval/`](scripts/agent-eval/) and is fully reproducible; full per-question judging in `eval-results/`.)*

---

## Performance

Performance is a design constraint here, not an afterthought.

| | |
|---|---|
| **Reads** | Sub-millisecond. The graph is a local SQLite database (`node:sqlite`, WAL) — reads never block the writer. |
| **Indexing** | ~**100 files in under 350 ms** on real repositories. A pool of WebAssembly tree-sitter workers parses in parallel and recycles memory on a fixed cadence so long runs stay flat. |
| **Footprint** | **100% local.** No daemon to babysit, no cloud round-trip, no embeddings service. The index lives next to your code and stays fresh through an incremental file watcher. |
| **Hot paths** | Audited for worst-case behavior. The script-path scanner that runs on **every source file at index time** is provably linear — a deliberately-crafted adversarial input that took **97 seconds** under a naive regex resolves in **0.1 ms** here. |
| **Degradation** | Bounded everywhere it matters: parse timeouts, per-function fan-out caps, worker recycling, and a 2-second-debounced watcher with a staleness banner instead of a silent stale read. |

---

## Capabilities

### 1. Cross-language / cross-process edges (`crossLang`)
From **any** indexed file — Python, JavaScript/TypeScript, Go, or a workflow rule — OmniWeave follows a shell-out to the local script it runs:

```python
def run_analysis(counts, out):
    subprocess.run(["Rscript", "scripts/deseq.R", counts, out])   #  →  crossLang → scripts/deseq.R
```

```
callees(run_analysis)   →  scripts/deseq.R        # the R script it runs
callers(scripts/deseq.R) →  run_analysis           # every site that runs it
```

It handles the idioms real code actually uses — array and flat-string forms, the `f"{sys.path[0]}/tool.py"` "this-directory" dispatcher pattern, top-level `__main__` entry points — and it *rejects* the ones it can't resolve (interpolated basenames, variable paths, an interpreter that's merely `echo`'d).

### 2. Multiple-dispatch semantic graph
R's S4 object system dispatches at runtime. OmniWeave makes the static skeleton navigable: `setMethod` becomes a `method` node wired to its class (`contains`) and its generic (`overrides`), and a bare `dispersions(x)` call routes to the generic — with the concrete dispatch targets one hop away along the dispatch graph. The pattern generalizes to any multiple-dispatch or virtual-method language.

### 3. Workflow data-flow DAG
Snakemake and Nextflow pipelines become a graph: each rule/process is a step, its `input:`/`output:` files are shared **artifact** nodes, and a producer and consumer that name the same path land on the *same* node — so the pipeline DAG is navigable with the standard `callers`/`callees` tools.

### 4. External-tool graph (`invokes`)
A pipeline step that runs an external binary (`bwa`, `samtools`, `STAR`) gets an edge to a shared **tool** node:

```
callers(STAR)   →  star_index, star_align, …      # every step in the pipeline that runs STAR
```

This is the cross-process hop no language server can follow and that local-script analysis doesn't cover.

---

## Use it from an agent

OmniWeave is **MCP-native**. Point your agent at it and it gains a code-intelligence toolset:

The four core tools — `explore`, `node`, `search`, `callers` — are exposed by default; the rest are opt-in via the `OMNIWEAVE_MCP_TOOLS` allowlist (fewer tools = fewer mis-picks).

| Tool | Answers |
|------|---------|
| `explore` | "How does X work / survey this area / trace this flow?" — the **primary** tool: one capped call returns the relevant symbols' source grouped by file and rides the polyglot edges (dispatch, cross-process, workflow) where `callers` and an LSP stop |
| `search` | "What is the symbol named X?" (just kind + location + signature) |
| `callers` / `callees` | "What calls this?" / "What does this call?" — every call site with `file:line`, including cross-language and cross-process hops and callback registrations |
| `node` | "Show me this symbol's (or file's) source + its caller/callee trail and blast radius" — a drop-in for `Read` on indexed files |
| `impact` | "What would changing this break?" |
| `files` / `status` | directory listing · index health |

```bash
omniweave serve --mcp        # stdio MCP server
omniweave init -i            # index the current repo
omniweave callers <symbol>   # or query directly from the CLI
```

---

## Quick start

```bash
git clone https://github.com/SolvingLab/OmniWeave.git
cd OmniWeave
npm install && npm run build      # tsc + vendored tree-sitter WASM (Node ≥ 22.5 for node:sqlite)
node dist/bin/omniweave.js init -i
node dist/bin/omniweave.js serve --mcp
```

---

## Engineering

- **Hand-written extractors, no `.scm`.** Each language is a focused TypeScript walker — adding a language or a relationship is a small, testable change, not a grammar rewrite.
- **Eval-gated.** A recall/precision harness with edge, reachability, and **negative** assertions guards every capability — red before the feature, green after, with teeth that fail if a target regresses. **1490** unit tests, 25 evaluation gates, zero known false positives across six real repositories.
- **A §1.5 benchmark** (`npm run benchmark`) measures, honestly, the bounded class of queries where the graph wins, ties, or loses against `grep`/LSP — including the ones it loses.

```
extraction (WASM tree-sitter workers)
  → graph (node:sqlite + FTS5)
  → resolution (name + import + framework resolvers, dispatch & cross-language synthesizers)
  → MCP server
```

---

## Scope

OmniWeave is a **general** code-analysis graph. Bioinformatics — R/S4, Snakemake/Nextflow, mixed tool-and-data pipelines — is its proving ground precisely *because* it is the hardest polyglot, cross-process terrain there is: **general engine, proven on the hardest domain.**

---

## License & acknowledgments

MIT — see [LICENSE](LICENSE). OmniWeave builds on the foundation of the open-source [codegraph](https://github.com/colbymchenry/codegraph) project (MIT); the extraction/graph/MCP core is inherited, and the cross-language, cross-process, dispatch, workflow, and tool layers are OmniWeave's own.
