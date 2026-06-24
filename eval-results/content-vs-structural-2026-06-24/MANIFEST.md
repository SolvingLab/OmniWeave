# Step A dataset & method manifest

**Decision under test (general-moat war plan §1 Step A):** is an indexed file-content
search an **outcome** win (agents *fail/regress* on content questions without one) or
an **economy** win (they tie on correctness, just spend ~1 extra grep)? The answer
sets the route: 10–20% "general CG replacement" vs 60–70% "best-in-niche + the only
structural graph that also does content search".

We **measure tool-calls/turns at equal correctness**. We do **not** claim a correctness
win for OmniWeave — that finding (correctness ties grep) is unmoved from rounds 1–7.

## Corpus (real, public, pinned)

| Repo | Commit | Lang | Files (.py) | Role |
|---|---|---|---|---|
| [django/django](https://github.com/django/django) | `420b4f5b0170d090d3b5b78b5c0d3986743e39db` | Python | 2924 (908 in `django/` src, 164,963 src LOC) | Large, content-rich app framework: string-literal error messages + structural call/extends graph in one repo |

Reconstruct: `git clone --filter=blob:none https://github.com/django/django && git -C django checkout 420b4f5b`.

> **Scope (honest):** this first decisive cut is **one large real repo**. The war plan's
> full Step A calls for 5 diverse repos (TS monorepo, Django, Spring, nf-core Snakemake,
> mixed C+Python). Django is the highest-yield single corpus for the content-vs-structural
> contrast (both axes live in it at scale). The verdict here is **directional**; widen to
> the other four before treating the route as settled. The harness is repo-agnostic
> (`run-step-a.sh <repo> <cgbin> <questions.json>`), so widening is re-running it.

## Questions (`questions.json`, GT-locked, per-question verifiable)

6 questions, balanced and **not stacked toward OmniWeave** (iron-law ④: includes a ceiling
question both arms must read):

- **3 structural** (the graph helps): `S1` extends, `S2` reverse/callers, `S3` callee/flow.
- **2 content** (string literals the symbol-graph cannot hold — the treatment): `C1`, `C2`.
- **1 ceiling** (`CEIL`, no-tool-advantage — anti-cherry-pick): both arms locate one function and read it.

Every `groundTruth` has a `gtSource` (`file:line`) that was grep-verified on the pinned
checkout. Grading is deterministic: the question's `gtRegex` must match the agent's final
answer text (case-insensitive).

## Arms (same model, same questions)

| Arm | Surface | What it tests |
|---|---|---|
| `omniweave` | OmniWeave MCP (structural; symbol-only FTS today) + Bash/grep + Read | structural-only OW; for content Qs it must fall back to Bash |
| `codegraph` | upstream codegraph 1.0.1 MCP (also no content index) + Bash + Read | the incumbent structural graph, same content gap |
| `grep` | no MCP — Bash grep + Read only | the baseline every host already has |

## Model & harness

- **Real LLM:** MiMo `mimo-v2.5-pro` (Anthropic-protocol), driven through the `claude` CLI.
  Keys are injected from `~/Desktop/本机AI-API资源盘点.md` at runtime and **never written to
  disk, commits, or logs**.
- **runs/arm/question:** 2 (run-to-run variance is real; never conclude from n=1).
- **Fail-closed:** non-zero `claude` exit, empty JSONL, or missing result → run marked
  INVALID, excluded from analysis, counted separately. No fake "0-tool" wins.
- Working dirs (`/tmp/step-a-*`) are ephemeral; `results/raw/*.jsonl` (transcripts + graded
  records) are committed. The django checkout is reconstructed via the command above, not
  vendored.

## Files

- `questions.json` — the GT-locked bank.
- `run-step-a.sh` — repo-agnostic 3-arm fail-closed runner (real MiMo).
- `score-step-a.mjs` — aggregates `results/raw/results.jsonl` into the decision table.
- `results/` — raw transcripts, graded `results.jsonl`, and `SCORES.md`.
- `README.md` — abstract + methods + results + honest verdict (this artifact's paper face).
