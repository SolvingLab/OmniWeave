# Can OmniWeave become a GENERAL codegraph replacement? — an ambitious, evidence-grounded strategy

**Date:** 2026-06-24 · **Trigger:** user wants OW to eventually replace codegraph (CG) for *everyone*, not stay a bio niche; "be bold, be ambitious"; pointed at BitFun/flashgrep.
**Method:** a 7-agent research+strategy+adversarial Workflow (`workflow-research-raw.json`) + firsthand verification of every load-bearing claim (real source, real `node:sqlite` test, real `gh api`).

> **One-line answer.** The ambition "replace CG for *everyone*" is **~10–20% achievable as stated** — but there is **one genuinely new, general, buildable bet** that makes OW *strictly better than CG on a dimension every agent uses*, and a **hard prerequisite** your own iron-law ⑥ already demands. Pursue both; do **not** pursue the parts that secretly reopen PARK.

---

## 0. The honest verdict (what to actually do)

| Move | Verdict | Why |
|---|---|---|
| **Close the framework-dispatch gap vs CG** (Pinia/Vuex/Redux/RTK/MediatR/Celery/Sidekiq/Laravel/Spring-event/C-fnptr) | **DO — it's debt, not ambition** | **Verified: OW is genuinely WEAKER than CG here** (see §2). Your iron-law ⑥ ("OW 绝不该弱于 CG") *requires* closing it. This is the prerequisite to *any* "replace CG" claim. |
| **Add an indexed file-content search** (`content_fts` FTS5 trigram over raw bytes, in-process) | **BUILD — but A/B-gate it FIRST** | The **one real new general lever**: OW becomes the only local MCP tool answering *both* "what calls X across boundaries" *and* "which files contain string Y" from one index. CG has neither; flashgrep is unadoptable (§3). |
| Collapse `DEFAULT_MCP_TOOLS` 5→1 | **DON'T** | Reopens the PARK'd "lower-shape-tax NO-GO" with no new OW A/B; breaking API change. |
| Port a Claude-Code `UserPromptSubmit` hook | **LOW PRIORITY** | Claude-Code-specific; OW's `AGENTS.md` twin already pre-injects structural context. A/B before building. |
| Adopt/wrap flashgrep | **CANNOT** | Private binary, GitHub 404, license unknown — legally unadoptable (§3). |

**Honest probability (from the adversarial red-team, which I endorse):** ~**10–20%** that this yields a *general* CG replacement; ~**60–70%** that it yields "the clearly-best tool for polyglot/workflow repos **plus** the only structural graph that also does indexed content search" — a defensible, genuinely-better-than-CG product, even though **correctness still ties** (that finding is unmoved). The ambition is worth pursuing *toward the 60–70% target*, with the 10–20% as upside if the content-search economy compounds at scale.

---

## 1. The landscape: 5 retrieval axes, and the one open gap (research)

A coding agent's retrieval needs split into 5 axes. Who owns each (2026 ecosystem scan):

| Axis | Owner | OW today | CG today |
|---|---|---|---|
| **Lexical-at-scale** (regex/substring over raw bytes) | ripgrep / Zoekt / flashgrep | **✗** (FTS5 is symbol-only) | **✗** |
| **Structural / xref** (calls/imports/extends) | **CROWDED**: CG(47k★), codebase-memory-mcp(158 langs, arXiv), Serena(25k★ LSP), blarify(SCIP), Codanna… | ✓ + 4 bridge edges + S4 (unique) | ✓ (12 EdgeKind) |
| **Semantic / concept** | claude-context / Cursor / voyage-code | ✗ (PARK: sidecar-only) | ✗ |
| **Precise xref** (SCIP/LSIF) | Sourcegraph | reads `.scip` (doesn't generate) | — |
| **Agentic navigation / orchestration** | **UNOWNED** | partial (honest output) | partial |

Two facts from the sweep matter most:
1. **The structural-graph space is brutally crowded** — every tool claims "fewer tokens / fewer tool calls," numbers converge, and OW has 0 stars / 0 paper / 0 distribution vs CG's 47k. Winning *here* on "more edges" is not a general strategy (and PARK already closed it).
2. **The lexical-at-scale axis is unoccupied by *every* structural-graph tool.** Neither CG nor any competitor in the snapshot indexes raw file *content*. That is the one categorical gap a structural graph could fill to become a *superset* of grep+graph in one surface (the "unified surface" hypothesis).

---

## 2. Verified fact: OmniWeave is currently WEAKER than CG on general framework edges

This answers the handoff's open §3 question ("std_diff: is OW stronger or weaker on edges?") and trips iron-law ⑥.

`research/.../codegraph/src/resolution/callback-synthesizer.ts` (**2751 lines**) emits framework-dispatch edges via:
`piniaStoreEdges, vuexDispatchEdges, reduxThunkEdges, rtkEdges, rtkQueryEdges, celeryDispatchEdges, sidekiqDispatchEdges, laravelEventEdges, springEdges, springEventEdges` — **plus standalone `c-fnptr-synthesizer.ts` and `goframe-synthesizer.ts`.**

OmniWeave's `src/resolution/callback-synthesizer.ts` (**2126 lines, −625**) emits **none** of these; there is **no** `c-fnptr-synthesizer.ts`. (Evidence: `framework-synthesizer-gap.txt`.)

**Implication.** On Vue (Pinia/Vuex), React (Redux/RTK), .NET (MediatR), Django (Celery), Rails (Sidekiq), Laravel, Spring, and C-callback repos — *huge swaths of general code* — OW's graph is **less complete than CG's**. The 2026-06-24 benchmark "ties" because its single-language repos were libraries/CLIs that don't exercise these frameworks; the gap is real and would show the moment a framework *app* is indexed.

**The red-team called closing this a "PARK violation / fork-tax scope-creep."** It is wrong on that one point: **iron-law ⑥ ("OW 绝不该弱于 CodeGraph, superset fork 起码平局") is a hard user constraint that overrides the "thin differential" preference.** A fork that aspires to *replace* CG cannot be *weaker* than CG on the most common app frameworks. Closing this is **debt repayment to satisfy ⑥**, not ambition. (Caveat the red-team is right about: do it with eval fixtures per synthesizer + `lang-parity.sh` remeasure, and accept the recurring upstream-sync cost knowingly. Its *agent-outcome* impact is still unproven — graph-completeness ≠ correctness — so sequence it behind the A/B in §4.)

---

## 3. flashgrep: what it is, and why the answer is "build the class, not wrap the binary"

Verified firsthand (`gh api repos/wgqqqqq/flashgrep` → **404**; binary symbols; BitFun integration source):
- flashgrep v0.2.7 = a **private, closed-source Rust daemon** BitFun bundles as prebuilt binaries. **License unknown → OW cannot legally wrap/redistribute it.**
- Architecture = **sparse-ngram inverted index** (Cursor-style, CRC32-weighted 3–8-char n-grams), **segmented Lucene-style tiered-merge**, base-snapshot + live overlay, **JSON-RPC daemon**, regex verification via ripgrep's `grep_searcher`. **36.1× vs ripgrep on Chromium** (60M lines), ~79s build, ~2.5 GB index. In BitFun it is **opt-in, off by default**, with a ripgrep fallback.
- **Adoptable open equivalents:** Zoekt (Apache-2, Go binary), ripgrep (MIT, subprocess), **SQLite FTS5 `trigram` (fully in-process, zero new dep)**, xgrep (MIT).

**Firsthand buildability proof** (`node:sqlite` 22.22.3): `CREATE VIRTUAL TABLE content_fts USING fts5(content, tokenize='trigram')` works; substring `MATCH 'Rscr'` hits. So OW can add flashgrep-*class* indexed content search **inside its existing node:sqlite engine** — no Rust binary, no sidecar daemon, zero-config preserved, and it **composes with the structural graph in the same DB**.

---

## 4. The strategy (sequenced, each step gated)

The build order is deliberately **A/B-before-build** for the speculative parts (your "未过 eval 的能力不算能力").

- **Step A — Decisive A/B FIRST (run before building the index).** 5 diverse real repos (TS monorepo 5k+, Django, Spring, an nf-core Snakemake pipeline, mixed C+Python) × 10 questions (5 structural, 5 *content* — half **literal**, half **regex**, per the red-team's Attack 3) × 3 arms (structural-only-OW + Bash/grep, CG, grep+Read) × real LLM, natural + forced, fail-closed. **The question it answers:** do agents *fail or regress* on content/Q7 questions with structural-only OW + Bash, or do they just spend ~1 extra tool call? If the former → the content index has real outcome value, build it. If the latter → it's an economy win only (still real, but "thin"), decide on that basis. **No correctness-win claims** — measure tool-calls/turns/tokens.
- **Step B — Parity debt (iron-law ⑥).** Port CG's framework synthesizers (Pinia/Vuex/Redux/RTK/MediatR/Celery/Sidekiq/Laravel/Spring-event/C-fnptr/GoFrame), one batch at a time, each with a red→green eval fixture on a real framework app + `lang-parity.sh` remeasure. Gate: OW ≥ CG on framework-app edge counts. This is required regardless of the ambition — OW must not be weaker than its base.
- **Step C — `content_fts` trigram index (the one new general lever).** `CREATE VIRTUAL TABLE content_fts USING fts5(path UNINDEXED, content, tokenize='trigram')`, populated in `indexAll` for files ≤ `MAX_FILE_SIZE`. Expose as a **`pattern:` mode on `omniweave_search`** (keep `query:` = symbol BM25) and as the empty-seed fallback in `explore`. **Honest caveats baked into docs:** trigram excels at literal substrings, *degrades on complex regex* (candidate set empty/huge → verify-scan); ~3.3× content storage (measure + report at 5k/20k/50k tiers; gate < 1 GB for < 50k files); build-time write-pressure through the single-writer WAL must be benchmarked (must not add >~30s to `init`). Do **not** make it a new default tool; do **not** collapse the 5-tool surface.
- **Step D — Output economy (free general wins, from BitFun).** Make `provenance`/`confidence` first-class on *every* edge (not just `crossLang`) → agents do fewer verification reads; add a `metadata-only` explore mode (structural preview at near-zero token cost); deterministic tool-listing order (KV-cache stability). All in the formatter, all general, all cheap.

---

## 5. Why this is the honest shape of the ambition

- **It changes coverage + economy, not correctness.** Correctness ties — that finding from 66 runs is unmoved and must never be dressed up. The bet is: *a superset of grep+graph in one local index* lowers tool-count/turns for *every* agent on *every* repo (general), and that economy compounds as repos grow and models weaken — exactly the axis your own benchmark already proves is OW's real value.
- **The moat is unification + the cross-boundary edges + zero-config, not raw speed.** OW will not out-run flashgrep/Zoekt (hardened Rust/Go daemons); it doesn't need to. Its defensible position is "the *only* local-first, zero-binary-dep MCP tool that fuses content + structure + cross-boundary edges + honest output in one SQLite index." flashgrep is unadoptable; Zoekt adds a Go binary; CG has no content index at all.
- **What would *kill* the general claim** (stated up front): if Step A shows agents already tie on content questions via Bash+grep at meaningful repo size, the content index is an *economy-only* win → OW remains "best-for-polyglot/workflow + a nice content-search bonus," i.e. the 60–70% outcome, not the general replacement. That is still a better product than today — just honestly bounded.

---

## 6. Bottom line for the user

Be ambitious **toward a reachable target**: not "magically more correct than CG," but **"the one local tool an agent needs for code retrieval — structure *and* content *and* cross-boundary *and* honest output, zero-config, in one index"** — while first paying the ⑥ debt that currently makes OW *weaker* than CG on common framework apps. The single highest-leverage next action is **Step A (the A/B)**: it tells you whether the content index is an *outcome* win (chase the 10–20% general replacement) or an *economy* win (bank the 60–70% best-in-niche-plus-superset). Build on the number, not the hope.

*Full research (flashgrep deep-dive, SOTA axes, CG weaknesses, OW scale audit, the strategy, and the adversarial red-team) is in `workflow-research-raw.json`; the framework-gap evidence is in `framework-synthesizer-gap.txt`.*
