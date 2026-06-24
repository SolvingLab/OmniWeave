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

24 runs (`omniweave` + `codegraph` arms; the `grep` arm is meaningless when grep is denied),
**0 INVALID**. `force-mcp-hook.sh` was confirmed live in-transcript: the agent's first move on
the content questions is a Bash `grep`, which is **denied** ("Shell and source-file reading are
disabled… answer using the attached code-graph MCP tools"), after which it falls back to
`omniweave_explore` / `omniweave_node`.

| Question | axis | omniweave (MCP-only) | codegraph (MCP-only) |
|---|---|---|---|
| S1-extends | structural | 100%✓ 3.5t 13.0τ | 100%✓ 3.0t 13.0τ |
| S2-callers | structural | 100%✓ 2.5t 9.0τ | **50%✓** 6.5t 18.0τ |
| S3-callees | structural | 100%✓ 3.0t 11.0τ | 100%✓ 3.5t 15.0τ |
| C1-literal | content | 100%✓ 2.0t 8.0τ | 100%✓ 1.5t 13.0τ |
| C2-literal | content | 100%✓ 2.5t **17.0τ** | 100%✓ 2.0t 10.0τ |
| CEIL | ceiling | 100%✓ 4.0t 16.0τ | 100%✓ 3.5t 11.0τ |

**The surprise that reframes the whole content thesis: even with grep DENIED, both tools
answered the content questions at 100% correctness.** `omniweave_explore "CSRF verification
failed"` lands on `django/views/csrf.py` and `omniweave_explore "Enter a valid email address"`
lands on `django/core/validators.py` — **not** because the FTS indexes those literals (it does
not), but because the literal lives in a file whose **symbols/filename are semantically
correlated** with the query terms (`csrf`, `validators`). The structural graph reaches
symbol-correlated content by proximity. The cost shows up as **turns, not correctness**: C2
omniweave averaged 17 turns (some runs flailed against the deny-hook before finding it) vs the
~5 turns the same question took in natural mode with a single grep.

(Side note, structural axis: forced omniweave 100% vs codegraph **83%** — codegraph failed one
of two `S2-callers` runs after 7 MCP calls / 24 turns. n=2, so this is an anecdote, not a
structural-moat claim — but it is the one place a correctness gap opened, and it favored
OmniweAVE, not the content question.)

## Honest verdict (both modes)

- **Correctness ties on content in BOTH modes.** Natural: 36/36, every arm greps. Forced: the
  structural graph still reaches symbol-correlated content by symbol/filename proximity. There
  is **no content question in this bank that a structural-only agent gets wrong** — so the
  content index's *outcome* value here is **zero**, and the 10–20% "general replacement via
  content index" route is **not** supported by this evidence.
- **Its value is a narrow EFFICIENCY/economy lever, gated by two things:**
  1. *Adoption* — in natural mode MiMo used the attached structural MCP **0 times in 36 runs**;
     it greps. A content index on the same MCP surface would be bypassed the same way by this
     model. (Stronger models adopt MCP more — prior benchmarks show that — so this is a
     model-strength-dependent bound, not a permanent one.)
  2. *Symbol-correlation* — when the string lives in a semantically-named file/symbol, the
     structural graph already finds it (sometimes with turn-flailing a content index would cut).
- **Build `content_fts` (it is DONE③ regardless), but frame it honestly:** a turn-cutting
  convenience for sandboxed/forced agents and an `explore` empty-seed fallback, **not** a
  correctness, outcome, or guaranteed-tool-call win. Never market it as "more correct".
- **The content gap that *would* need it** is the **symbol-UNcorrelated** string — a literal in
  a file whose name/symbols don't echo the query (a generic message in a misc util). **This bank
  does not test that case** (CSRF→csrf.py and email→validators.py are both correlated), so the
  true ceiling of the gap is *un-measured here*. That, plus widening to the other four war-plan
  repos and a stronger model, is the honest next experiment before the route is settled.

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
