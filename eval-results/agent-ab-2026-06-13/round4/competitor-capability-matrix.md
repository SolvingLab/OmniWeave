# Round 4 — Competitor capability head-to-head (grep / Aider repo-map / LSP / OmniWeave)

> Track 2. grep is a weak baseline; "world-best" must beat the real competitors a
> local/model-first agent already has: **LSP** (incomingCalls/goToImplementation) and
> **Aider repo-map** (in-process tree-sitter tags + PageRank). This file records the
> *grounded, reproducible* capability probes — every row is a real command/tool call,
> output-or-it-didn't-happen. Fair regime = **fresh checkout, zero-config** (clone +
> index, no `pip install`, no build) — exactly what the agent-eval harness does, and the
> regime all four tools are entitled to.

## Instruments (all real, all run on the indexed /tmp corpus)
- **grep/read**: language-agnostic, zero-config. Always available to the agent.
- **OmniWeave**: dev build (`omniweave --version` = 0.1.0), static source index. Zero-config.
- **LSP**: the harness `LSP` tool. `typescript-language-server` ✓ on PATH (TS works);
  `pyright-langserver` installed via `npm i -g pyright` (Python). R languageserver absent.
- **Aider repo-map**: `pipx install aider-chat` **failed on this machine** (aider pins
  `numpy==1.24.3`, which has no wheel for Python 3.13 and fails to build). The repo-map
  comparison is therefore **categorical** (same method the design §1.5 uses for LSP
  request-types): Aider's repo-map is, by construction, a *ranked list of file
  signatures* (tree-sitter tags → reference graph → PageRank → token-budget truncation).
  It emits **no navigable edges** — no "who-calls-X", no cross-process bridge, no dispatch
  target. It is a *context-selection* heuristic, not a *query* interface. So it cannot
  answer any of the navigation/dispatch/cross-process questions below — not slower, but
  structurally (it has no edge to return). This gap does not depend on a running instance.

## Grounded probe results (so far)

### P1 — TS same-language reverse callers (vscode `TextModel.getDecorationRange`)
Round-3 ground truth: 51 caller functions / 26 files (one impl @ textModel.ts:1798).

| tool | result | calls/effort |
|---|---|---|
| grep+read | complete (round 3) | 47 tool calls, 1.13M tok, 6 min (brute read) |
| **OmniWeave** | complete (52≈51) | **2 calls**, 95K tok, 77s |
| **LSP** (ts-language-server, `incomingCalls` @1798:9) | **45 incoming calls**, by subsystem | **1 call**, instant |
| Aider repo-map | — | cannot (no call edges) |

**Verdict: TS same-language callers = OmniWeave ≈ LSP (both 1-call complete) ≫ grep (effort).**
LSP returned 45 vs ground-truth 51 — slightly under (call-hierarchy missed a few sites);
OmniWeave's 52 is marginally more complete. **Honest: on TS, LSP is a peer, not a victim.**
This is exactly design §1.5②: *don't collide with LSP on same-language navigation.*

### P2 — TS interface dispatch (`ITextModel.getDecorationRange` → impl)
Interface decl @ model.ts:1114 + monaco.d.ts:2264; impl @ textModel.ts:1798.

| tool | result |
|---|---|
| **LSP** (`goToImplementation` @1114:2) | **textModel.ts:1798:9** — exact, 1 call |
| grep+read | `grep getDecorationRange` → 3 hits (2 decls + 1 impl); pick impl by reading |
| OmniWeave | lists the symbol; resolution by qualified name |

**Verdict: TS interface dispatch = LSP wins (compiler-grade, 1 call).** OmniWeave does **not**
beat LSP here. → category (a) ambiguous-dispatch is **LSP's turf on TS**; OmniWeave's
dispatch value must come from where LSP is blind (next rows), not TS.

### P3 — Python zero-config reverse callers (django `iri_to_uri`, 17 real callers)
Round-3 ground truth: 17 caller functions across 12 files.

| tool | result | note |
|---|---|---|
| grep+read | complete (round 3, 17/17) | brute read, 31 tool calls |
| **OmniWeave** | complete (17/17) | 2 calls (round 3) |
| **LSP** (pyright `incomingCalls` @107:5) | **"No incoming calls found"** | ✗ blind |
| **LSP** (pyright `findReferences` @107:5) | **1 reference (the def itself)** | ✗ blind |

**Verdict: Python zero-config = OmniWeave & grep WIN; LSP (pyright) is BLIND.**
Root cause (grounded): pyright cannot resolve `from django.utils.functional import ...`
on an *uninstalled* checkout (diagnostic: *"Import could not be resolved"*), so its
cross-module call graph collapses to nothing. This is the design §1.5 *"any repo,
zero-config"* regime — LSP's compiler-grade precision is **conditional on a configured
environment**; OmniWeave/grep/Aider index the static source directly and need none.
(Caveat for fairness: in an agent's *real* venv with deps installed, pyright would
resolve. The zero-config gap is real but environment-shaped, not an algorithm flaw.)

### P4 — Cross-process bridge (quarTeT `quartet.py` → subprocess → scripts → tools)
Ground truth (hand-built): `quartet.py AssemblyMapper` →(subprocess f-string
`{sys.path[0]}/quartet_assemblymapper.py`)→ that script →(in-process)→
`quartet_util.mummer/minimap` →(subprocess f-string)→ **nucmer / delta-filter /
show-coords / minimap2 / unimap**.

| tool | hop1 (entry→script) | hop2 (script→external tools) |
|---|---|---|
| **LSP** | ✗ categorical (no symbol spans the subprocess string; cross-file *and* the target is a string) | ✗ |
| grep+read | ~ basename `quartet_assemblymapper.py` is literal → greppable, then read | ~ read quartet_util.py, find `nucmer`/`minimap2` in f-strings |
| **OmniWeave** | ✓ crossLang edge `quartet.py → quartet_assemblymapper.py` (1 call) | **✗ partial** — `callees(mummer)` → `runsub` only; raw `subprocess.run(f'nucmer…')` inside a helper is **not** captured as a tool node (`invokes` fires only for Snakemake `wrapper:`) |

**Verdict: cross-process hop1 = OmniWeave wins vs LSP (categorical) & ties/beats grep on
effort; hop2 (tool names) = grep ties (reads the f-string), OmniWeave incomplete (honest
ceiling: no raw-subprocess-tool capture).** So quarTeT is a **partial** OmniWeave win, not
a clean sweep — recorded honestly.

## Emerging head-to-head shape (to be completed with the A/B + Track-1 results)
- **vs grep**: correctness ties almost everywhere (the agent can always *read*); OmniWeave's
  moat is **effort/cost/token**, monotone in repo size (rounds 1–3).
- **vs LSP**: **ties on same-language TS navigation** (peer, not victim); **wins on
  zero-config Python (pyright blind), cross-language, cross-process, and R-S4 runtime
  dispatch** (all categorically or environmentally outside LSP).
- **vs Aider repo-map**: categorical — repo-map returns ranked context, never an edge, so
  it cannot answer any navigation/dispatch/cross-process question.
