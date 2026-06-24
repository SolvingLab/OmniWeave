<div align="center">

# OmniWeave

### A high-performance, polyglot **code-analysis graph** for coding agents

**Weave a whole repository — across languages, across processes — into one navigable graph.**

The relationships that matter most to an agent are exactly the ones a language server and `grep` can't follow: a Python orchestrator that shells out to an R script, a Snakemake rule that runs an external binary, an S4 method dispatched at runtime. OmniWeave makes those hops **first-class, typed, traversable edges** — answered in a single sub-millisecond query.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Local](https://img.shields.io/badge/100%25-local-brightgreen.svg)](#performance)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-blue.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-native-blueviolet.svg)](#use-it-from-an-agent)
[![Tests](https://img.shields.io/badge/tests-1760%20passing-success.svg)](#engineering)
[![Agent A/B](https://img.shields.io/badge/agent_A%2FB-7_rounds_measured-orange.svg)](#does-an-agent-actually-do-better-with-omniweave)

</div>

---

## Why OmniWeave

A coding agent already has `grep` and an LSP. OmniWeave earns its place by winning *exactly where they stop*:

- **Cross-language.** An LSP is scoped to one language. OmniWeave links a `.smk` rule, a `.nf` process, or a plain Python function to the **R / Python / Perl script it runs across the process boundary** — and on into that script's functions and methods.
- **Cross-process.** A subprocess argument is opaque to a language server. OmniWeave resolves `subprocess.run([...])`, `os.system(...)`, `child_process.*`, `exec.Command`, and workflow directives into a real edge you can traverse both ways.
- **Dynamic dispatch.** Runtime dispatch is invisible to static call graphs. OmniWeave models R's S4 `setGeneric`/`setMethod` as a dispatch graph (class → method → generic) and routes a bare generic call to the right entry point.
- **Token economy.** One typed, traversable answer instead of a dozen `grep` passes the agent has to re-parse. The graph is built **by relationship**, not padded by language count.

> **Honest by construction.** Every inferred edge carries a `provenance` and a `confidence`. What can't be known statically — a runtime-built path, NSE, runtime dispatch — is *skipped, never guessed*. Empty results return a recovery path, not a dead-end; nothing irrelevant or stale is surfaced as fact; and the daemon refuses to serve answers from code that no longer matches what's on disk. The agent is never handed a fabricated edge — or a stale one — it might trust.

---

## Does an agent actually do better with OmniWeave?

Not a claim — a measurement. An A/B benchmark across **7 rounds, 15+ real repositories, ~140 headless runs**, 5 languages (R · Python · TS · Java · polyglot), 3 model families (Claude Sonnet + Haiku + a local weak model), identical prompts. Rounds 1–6 hold the *only* variable to whether OmniWeave's MCP graph is attached (both arms keep the same built-in `grep` / `read` / `bash`); round 7 isolates a second axis — whether the graph's **output** misleads the agent — by diffing the current build against a pre-hardening one on the same index. Tool-calls are the reliable effort signal (token cost is prompt-cache-sensitive); both are reported. **Every number below is reproducible** (`scripts/agent-eval/`, raw transcripts and per-question judging in `eval-results/`).

**What the seven rounds actually establish is two contributions — and neither is "more correct."** First, **economy of form**: for reverse/blast-radius at scale, cross-boundary structure an LSP can't see, zero-config checkouts, and weaker models, OmniWeave reaches the *same* answer in a fraction of the tool-calls and tokens, scaling *up* with repo size. Second, **trustworthy output**: it is built so the agent is never silently misled — every inferred edge carries provenance/confidence, the unknowable is skipped rather than guessed, empty results return a recovery path instead of a dead-end, and (round 7) it no longer leaks irrelevant or competitor-snapshot source into the agent's context. The rest of this section is the evidence for both, ties included.

### The bottom line, by query shape

OmniWeave doesn't win everywhere, and it's built to tell you where. The first six rounds (efficiency) map a precise boundary:

| Use it for — **clear win** | It's a **tie** (use anything) | Reach for `grep`/LSP instead |
|---|---|---|
| **Reverse / blast-radius on a large repo** — "what calls X", "what breaks if X changes" (1/20 the tool calls, scales *up* with repo size) | **Single-point lookup** — "what/where is X" (grep is just as fast; the graph is neutral) | **Cross-process at scale** — large repos build subprocess commands at runtime; that's the honest ceiling for everyone |
| **Cross-language / cross-process / dynamic-dispatch** hops an LSP is structurally blind to (Python→R, S4 dispatch, workflow→script) | **Same-language navigation when an LSP is already running** (compiler-precise, free — OmniWeave ties it) | **Concept/semantic search** — "where's the auth logic" is vector-search territory, not a structural graph |
| **Zero-config checkouts** (no build/install env) where an LSP resolves nothing | **Correctness on any well-posed question** — a capable agent ties grep+read either way | **A language OmniWeave doesn't extract well** — `grep` reads everything |
| **Weak / cheap models**, where an unaided agent flails worst (see the model-strength curve) | | |

**The honest one-liner:** OmniWeave is *not* more correct than `grep` and it is *not* a universal win. It is the **most economical form** for one specific intersection — same-language large-repo reverse/blast-radius **plus** cross-boundary structure an LSP can't see **plus** zero-config **plus** weaker models — and it ties (doesn't hurt) almost everywhere else. The rest of this section is the evidence for each of those claims, including the ties.

### The efficiency moat (measured)

| Query · repo | Correct? | Tool calls *(with / without)* | Cost |
|---|---|---|---|
| Single-point lookup · small repos (≤ 450 files) | tie | **17 / 31** (−45%) | ≈ tie |
| Reverse / multi-hop · small repos | tie | **16 / 34** (−53%) | −16% |
| **Reverse blast-radius · django** (3,005 files) | **tie** | **2 / 31** (−94%) | **−64%** |
| **Reverse blast-radius · vscode** (11,538 files) | **tie** | **2 / 47** (−96%) | **−76%** |
| Structurally-ungreppable · dispatch trap / cross-process / deep transitive | **tie** | varies (see below) | varies |

On vscode, the plain `grep` / `read` agent reached the **same correct answer** — but spent **47 tool calls, 1.13 M input tokens, and ~6 minutes** brute-force-reading files to map every call site back to its enclosing function. With OmniWeave: **2 calls, 95 K tokens, 77 seconds** — one structural query instead of a file-by-file sweep. **The bigger the repo, the more `grep`'s read budget explodes; OmniWeave stays O(1).**

### Correctness is a tie — and we tried hard to break that

The most important honest finding: **OmniWeave does not make an agent *more correct*.** Round 4 built questions designed to be structurally ungreppable — a Java virtual-dispatch **trap** (`Ordering.natural().reverse()`, where the naive read returns the wrong class), a cross-process subprocess chain, a 4-hop transitive blast radius — across Java/Python/polyglot, **both Sonnet and Haiku, 3 runs each**. Correctness still **tied in every case** (the dispatch trap: 12/12 correct, both arms, both models). A capable agent *reads and verifies* its way to the right answer, and OmniWeave's own static edges hit the same honest ceiling — they route to a *declaration*, not a runtime-dispatch target. **So the moat is never "more correct." It is effort: tool-calls, tokens, turns, latency, cost.**

### The moat is effort — and it is bounded

It opens on **reverse / blast-radius** queries and **widens with repo size**: same correct answer, but the unaided agent pays an O(call-sites) read tax the graph answers in O(1). It does **not** open everywhere:

- **Cross-process at scale evaporates.** Round 4's small-repo cross-process win (quarTeT, 7 files) *should* have widened on a real ≥1,000-file polyglot repo. It didn't — on MAESTRO (1,729 files, Python→R) effort **tied** (11.7 vs 12.3 tool calls). Across 15 large repos measured, the clean static sibling-script chain OmniWeave wins on simply doesn't occur at scale; real large repos build subprocess commands at runtime (`Rscript {install_dir}/x.R`) — the honest ceiling for `grep` **and** OmniWeave alike, so the agent just falls back to `grep`.
- **Single-point queries carry a small form-tax, not a win.** A signature lookup is `grep`'s home turf; a query-shape routing layer in the server instructions cuts the overreach (138 K → 92 K tokens, tying `grep`'s 90 K) but can't make the graph *win* a question grep already answers in one read.

### Weaker model → wider moat, but less reliably captured

A 4-archetype × Haiku-vs-Sonnet matrix sharpened the "weaker model" claim. **With** the graph, both models collapse to ~2–3 tool calls on every archetype — the graph erases the strength gap. **Without** it, the size of the gap depends on the metric: in raw tool-count both fan out wide (a strong model *more*, because it fires greps in parallel); but in **tokens and turns** the weak model is hit far harder — on a transitive blast-radius, Haiku-without burned up to **1.73 M tokens / 33 turns** where Sonnet-without parallelised into a steady **65 K / 2 turns**. The graph's real value to a weak model is **protection from catastrophic serial flailing** — wider, but **less reliably captured**: Haiku sometimes ignored the attached graph and grepped anyway (1 of 3 runs). Correctness stayed a tie throughout.

### What it costs to attach: ~682 tokens

A common worry about MCP graphs is system-prompt bloat. Measured directly (same question, same model, attached vs not), the steady-state first-turn cost is **30,586 tokens without OmniWeave vs 31,268 with — a marginal +682.** The other ~30 K is the base agent harness (built-in tool deferral + tool-search machinery), present in *both* arms. OmniWeave's tool schemas are deferred until first use, so they never sit in the system prompt idle. (Disabling that deferral to "save a round-trip" actually *costs* +16 K tokens by eager-loading every schema — the default is already token-optimal.) **Attaching the graph is nearly free; the cost is the structural answer you choose to fetch, not the connection.**

### Round-6 output precision

The graph's value is only as good as the precision of what it hands back, so round 6 audited every tool's output and tightened `callers`/`callees`: the list now reports the **true total** (`showing 20 of 57`, never a silently-capped `20 found` that makes an agent under-count), and **drops file-level `import` edges that aren't calls** — a file importing a name is a dependency, not a caller, and was redundant with the function-level callers from the same file (the full dependency closure stays on `impact`). On a 57-caller symbol this shrank the tool result **33 %** and removed a manual de-noising step the agent had been doing by hand, with **zero correctness change**. *(Honest caveat: on that symbol the agent's reported count varied across arms — 57/50 with the graph vs 136/206 with `grep` — not because either is "wrong" but because "distinct caller" is genuinely ambiguous in factory code full of anonymous accessors. The graph's answer is **stable**; `grep`'s varies run to run. The moat there is effort and stability, not correctness.)*

### Round 7 — the tool that doesn't mislead

Efficiency is one contribution; **trust** is the other, and round 7 measured it directly. The question: did a 71-commit output-honesty pass actually help an agent, or just feel tidier? It was isolated by diffing the current build against the commit *before* that pass — **same index, so the only variable is the output code** — on a local weak model.

The cleanest result is deterministic (no LLM needed). Ask `explore` for a **symbol that doesn't exist**:

| | pre-hardening | now |
|---|---|---|
| Output for a missing symbol | **24,273 chars** — a blast radius of unrelated `Symbol` classes pulled from **gitignored competitor checkouts** (`serena`, `scip`, `cgc`, `aider`…) | **558 chars** — "empty result, not a tool failure" + a recovery path |

Pre-hardening, OmniWeave indexed source a `grep` *can't even see* (the repo vendors competitor checkouts under a gitignored path) and then **leaked it into the agent's context** — so on a missing symbol it was briefly **dirtier than `grep`**, handing the agent ~6 K tokens of someone else's code to be misled by. The hardening makes it **as clean as a gitignore-aware `grep`, plus a recovery path**. In the agent A/B, asking "does this repo do vector search?" (it doesn't — that's a deliberate non-feature), the pre-hardening `explore` dumped competitor embedding code and the agent spent **~2 extra tool calls / ~2 extra turns** discounting it as "not first-party"; on the weak model the worst pre-hardening run flailed to **8 turns / 160 K tokens** where the hardened arm held at 3–4. **Correctness tied every time** — a capable agent recovers either way — so, as everywhere else, the contribution is *effort and trust, not correctness*.

> **Honest boundary.** Snapshot-suppression is **not** a moat *over* `grep` — a gitignore-aware `grep` never saw those files. It is OmniWeave fixing *itself*: an index that reaches further than `grep` must be at least as disciplined about what it surfaces. The generalizable wins — empty-result recovery, honest call-surface, one-call source instead of a forced re-read — hold on any repo; the competitor-snapshot specifics are amplified by *this* repo vendoring rival source.

A matching distribution-trust fix lives below the output: a long-running daemon holds the code it loaded, so a `npm run build` (same version, new logic) used to let a stale daemon serve pre-rebuild answers while claiming to be current. The daemon/proxy handshake now rendezvous on a **build fingerprint** (version + content hash), so a freshly-rebuilt client detects the stale daemon and serves in-process with current code. The "most trusted" claim has to hold for the tool's own running instance, not just its edges.

### Versus the alternatives

The comparison that matters isn't just `grep` — it's the tools an agent already has:

| | What it does | Where OmniWeave stands |
|---|---|---|
| **`grep` + `read`** | Reads everything, follows nothing | **Ties on correctness**, wins on **effort** for reverse/blast at scale (1/20 tool calls), wider on weak models |
| **LSP** (`tsserver`, `pyright`) | Compiler-precise same-language nav, **free, often already running** | **Ties** on its home turf; OmniWeave wins only where LSP is **blind** — zero-config checkouts (pyright resolved 0/17 callers without an env), cross-language, cross-process, R/S4 dispatch |
| **Aider repo-map** | PageRank-ranked context list | **Category win** — a ranked list has no traversable edges, so it can't answer "what calls X across a process boundary" at all |
| **Vector / embedding search** | Concept recall ("where's the auth logic") | **Different tool** — OmniWeave is structural, not semantic; it does not compete here and shouldn't be used for it |

The takeaway is the one stated up front: a real, measured efficiency edge in a **bounded intersection** plus an output the agent can trust, honest ties or no-help outside it. (Full methodology, per-question ground truth, and raw transcripts in [`eval-results/`](eval-results/) — the rounds-1–6 efficiency study in [`agent-ab-2026-06-13/`](eval-results/agent-ab-2026-06-13/), the round-7 output-honesty study in [`agent-ab-2026-06-23/`](eval-results/agent-ab-2026-06-23/).)

---

## Configuration

OmniWeave is zero-config by default. If a repository uses a custom extension for a supported language, add a small `omniweave.json` at the project root:

```json
{
  "extensions": {
    ".dota_lua": "lua",
    ".tpl": "php"
  }
}
```

Mappings apply to full indexing, incremental sync, and watching. They override built-ins only when explicitly declared.

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

### 2. Multiple-dispatch structural graph
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

The five core tools — `explore`, `node`, `search`, `callers`, `impact` — are exposed by default; the rest (`callees`, `files`, `status`) are opt-in via the `OMNIWEAVE_MCP_TOOLS` allowlist (fewer tools = fewer mis-picks).

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
omniweave snapshot export .omniweave-snapshot
omniweave scip import index.scip --json
```

`scip import` is intentionally artifact-only: it reads an existing `index.scip`, imports safe same-language facts with `provenance=scip`, and never runs a SCIP indexer or creates runtime/cross-boundary claims.

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
- **Eval-gated.** A recall/precision harness with edge, reachability, and **negative** assertions guards every capability — red before the feature, green after, with teeth that fail if a target regresses. **1760** tests, 25 evaluation gates, zero known false positives across six real repositories.
- **A §1.5 benchmark** (`npm run benchmark`) measures, honestly, the bounded class of queries where the graph wins, ties, or loses against `grep`/LSP — including the ones it loses.
- **Adversarial agent A/B evaluation** (`scripts/agent-eval/`, seven rounds in `eval-results/`). Rather than trust a self-reported metric, every value claim is measured by running a real coding agent **with vs without** the graph attached, on real repositories, with human-judged ground truth — and the discipline is to *go looking for where the tool loses*: correctness ties were confirmed by building traps meant to break them, a prior round's "~34 K overhead" claim was retracted after direct measurement (+682), the cross-process-at-scale and in-process-mode bets were both retired as NO-GO, and round 7's headline win — suppressing leaked competitor-snapshot source — was recorded as OmniWeave fixing *itself* (it had been dirtier than `grep`), not as a moat over `grep`. The boundary in this README is drawn by that evaluation, not by marketing.

```
extraction (WASM tree-sitter workers)
  → graph (node:sqlite + FTS5)
  → resolution (name + import + framework resolvers, dispatch & cross-language synthesizers)
  → MCP server
```

---

## Scope

OmniWeave is a **general** code-analysis graph. Bioinformatics — R/S4, Snakemake/Nextflow, mixed tool-and-data pipelines — is its proving ground precisely *because* it is the hardest polyglot, cross-process terrain there is: **general engine, proven on the hardest domain.**

**What it is not**, stated plainly so you can choose the right tool: it is not a correctness oracle (a capable agent ties it with `grep`), not a semantic/concept search (that's embeddings), not a replacement for a language server on same-language navigation (it ties one), and not a universal win (single-point lookups and cross-process-at-scale are honest ties). What it **is**: the most economical structural form for the bounded intersection mapped above, *and* an output an agent can trust — provenance on every inferred edge, the unknowable skipped rather than guessed, no leaked or stale source masquerading as fact. Economy of form and trustworthy output — measured, ties included — and built to tell you exactly where its boundary is.

---

## License & acknowledgments

MIT — see [LICENSE](LICENSE). OmniWeave builds on the foundation of the open-source [codegraph](https://github.com/colbymchenry/codegraph) project (MIT); the extraction/graph/MCP core is inherited, and the cross-language, cross-process, dispatch, workflow, and tool layers are OmniWeave's own.
