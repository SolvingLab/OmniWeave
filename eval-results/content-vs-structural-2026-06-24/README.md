# Step A — Content vs Structural: is a file-content index an *outcome* win or an *economy* win?

**Date:** 2026-06-24 · **Model:** MiMo `mimo-v2.5-pro` (real LLM, Anthropic-protocol) ·
**Corpus:** django/django @ `420b4f5b` (2924 .py, 908 src files, indexed to 3,009 files /
61,802 nodes by *both* OmniWeave and codegraph — node-parity confirmed) ·
**Harness:** `run-step-a.sh` (3-arm, fail-closed) + `score-step-a.mjs`.

> This is **Step A** of the general-moat war plan: the decision that frames whether
> OmniWeave's planned `content_fts` index is a path to a *general* CG replacement
> (10–20%) or a best-in-niche economy add-on (60–70%). **We measure tool-calls/turns at
> equal correctness. We never claim a correctness win** — that finding (correctness ties
> grep) is unmoved from rounds 1–7 and is reconfirmed here.

## Abstract

A coding agent's retrieval splits into *structural* (calls / extends / callers — symbols
and edges) and *content* (a string literal or pattern that is **not** a symbol). OmniWeave
and codegraph both index structure; neither indexes raw file content (their FTS is
symbol-metadata only). The war plan's one new general lever is a trigram `content_fts`
index. Before building it we ask, on a real large repo with a real LLM: when the agent
faces a **content** question, does the structural-only tool **fail/regress**, or does it
just spend ~1 extra grep? We run two complementary modes:

- **Natural mode** (Bash/grep available — the realistic setting): measures *adoption +
  economy*. Does the agent even reach for the structural MCP, and what does content cost?
- **Forced mode** (`force-mcp-hook.sh` denies Bash/Grep/source-Read — MCP is the only
  surface): measures *sufficiency*. With grep removed, can the structural graph answer a
  content question at all?

## Method

6 GT-locked questions (`questions.json`, every `groundTruth` grep-verified to a
`file:line` on the pinned checkout), deliberately **not stacked toward OmniWeave**
(iron-law ④): 3 structural (extends / callers / callee), 2 content (string literals), 1
ceiling (no-tool-advantage — both arms must read one function). Three arms — `omniweave`
(structural MCP + Bash), `codegraph` (structural MCP + Bash), `grep` (Bash + Read only) —
same model, 2 runs/arm/question. Correctness graded deterministically by the question's
`gtRegex` against the agent's final answer. **Fail-closed:** non-zero exit / empty JSONL /
missing result → INVALID, excluded, counted. Keys injected at runtime, never on disk.

MCP availability was verified in-transcript: the `system/init` event for every `omniweave`
run lists all five `mcp__omniweave__*` tools — so a `0` MCP-call count is the agent's
**choice**, not a connection failure.

## Results — natural mode

36 runs, **0 INVALID** (fail-closed passed). Correctness✓ / mean tool-calls t / mean turns τ:

| Question | axis | omniweave (struct+Bash) | codegraph (struct+Bash) | grep (Bash+Read) |
|---|---|---|---|---|
| S1-extends | structural | 100%✓ 1.5t 5.0τ | 100%✓ 1.5t 6.0τ | 100%✓ 2.0t 6.0τ |
| S2-callers | structural | 100%✓ 3.5t 9.5τ | 100%✓ 3.0t 8.5τ | 100%✓ 4.5t 11.5τ |
| S3-callees | structural | 100%✓ 1.0t 4.0τ | 100%✓ 1.0t 4.0τ | 100%✓ 1.0t 4.0τ |
| C1-literal | content | 100%✓ 1.5t 5.0τ | 100%✓ 1.5t 5.0τ | 100%✓ 1.0t 4.0τ |
| C2-literal | content | 100%✓ 1.5t 5.0τ | 100%✓ 3.0t 8.0τ | 100%✓ 1.5t 6.0τ |
| CEIL | ceiling | 100%✓ 1.0t 4.0τ | 100%✓ 2.0t 6.0τ | 100%✓ 2.5t 7.0τ |

**The one finding that dominates everything: MiMo never adopted the structural MCP.**
Across all **36 runs — 0 MCP tool calls** (`omniweave_*` and `codegraph_*` combined),
even though the `system/init` transcript confirms all five MCP tools were attached and
available, and even on the purely structural questions (extends / callers / callee) where
the MCP is the *designed* answer. The agent answered **36/36 correct** entirely through
Bash grep + Read. The "omniweave arm" is therefore operationally identical to the "grep
arm" — same tool (grep), same answers — because the agent makes the same choice regardless
of what MCP is attached. (Total grep+bash calls: omniweave 14, codegraph 18, grep 19 — the
spread is run-to-run noise at 0 MCP usage, not an MCP effect.)

**Content axis specifically** (the treatment): omniweave 1.5t vs grep 1.3t at 100%=100%
correctness. The structural-only agent did **not** regress on content — it just grepped the
string literal like every other arm. A content index would have to be *adopted over grep*
to save even that ~1 call, and this run shows MiMo does not adopt an attached index at all
on django.

**Empirical content-gap check** (motivates Step C, independent of the agent): on a 2-file
fixture with the string literal `"quantum flux capacitor misaligned"` inside a function
body, `omniweave search "quantum flux capacitor"` returns **nothing** (the FTS is
symbol-metadata only), while `grep` finds it instantly. The gap a `content_fts` would fill
is real; whether an agent would *use* it over grep is the open question this run answers
skeptically.

## Results — forced mode (MCP-only, grep denied)

_Forced-mode run (`force-mcp-hook.sh` denies Bash/Grep/source-Read; arms `omniweave` +
`codegraph`) is in progress; results land in a follow-up commit. Hypothesis under test:
with grep removed, the structural-only graph **cannot** answer the content questions
(`omniweave_search` is symbol-only), so content correctness should drop on `C1`/`C2` while
structural questions stay answerable — the conditional sufficiency case for `content_fts`._

## Honest verdict (natural mode — directional)

- **Correctness ties everywhere** (36/36, all six questions, all three arms). Reconfirms
  rounds 1–7: OmniWeave is not "more correct"; we make no such claim.
- **The content index is, at most, an ECONOMY win — and on this model/repo not even that.**
  MiMo answered every content question by grepping the literal in ~1 call; an attached
  structural MCP was used **0 times in 36 runs**, so a content index (also MCP-surfaced)
  would face the same non-adoption. The 60–70% "best-in-niche + superset" route is the
  honest read; the 10–20% "general replacement via content index" route is **not** supported
  by this evidence — a weak model with grep available does not reach for an attached index.
- **The content gap itself is real** (the `omniweave search` empirical check), so `content_fts`
  remains worth building for the surfaces that *do* adopt it (forced/sandboxed agents, and
  `explore` empty-seed fallback), but its value must be framed as adoption-gated economy,
  not a general correctness or even guaranteed tool-call win.
- **Caveat (n=1 model × 1 repo, and a greppable bank):** these structural questions are all
  greppable on a tidy Python repo, so they do not exercise the cross-boundary structural moat
  (where prior benchmarks *did* see MiMo adopt OmniWeave). The finding is specifically about
  *content* retrieval and *weak-model adoption*. Widen to the other four war-plan repos and a
  stronger model before treating the route as settled. Forced mode (below) adds the
  sufficiency half.

## Reproduce

```bash
git clone --filter=blob:none https://github.com/django/django && git -C django checkout 420b4f5b
npm run build   # in the OmniWeave repo
export ANTHROPIC_BASE_URL=... ANTHROPIC_AUTH_TOKEN=... MODEL=mimo-v2.5-pro   # MiMo
# natural mode (3 arms):
eval-results/content-vs-structural-2026-06-24/run-step-a.sh <django> \
  research/2026-06-23-codegraph-ecosystem/repos/codegraph/dist/bin/codegraph.js \
  eval-results/content-vs-structural-2026-06-24/questions.json 2
node eval-results/content-vs-structural-2026-06-24/score-step-a.mjs \
  eval-results/content-vs-structural-2026-06-24/results/raw/results.jsonl \
  eval-results/content-vs-structural-2026-06-24/questions.json
```

## Scope & honesty

- **One large real repo** (django). The war plan's full Step A is 5 diverse repos; this is
  the highest-yield single corpus for the content/structural contrast at scale. The verdict
  is **directional** — widen before treating the route as settled. The harness is
  repo-agnostic, so widening is a re-run.
- **No correctness-win claim.** The headline metric is *tool-calls/turns at equal
  correctness*; correctness ties are the expected, honest outcome and are recorded as such.
- The ceiling question is included precisely so the bank is not stacked toward OmniWeave.
