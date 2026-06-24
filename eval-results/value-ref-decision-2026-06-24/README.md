# Value-reference edges (Ruby constant reads) — deferred, with evidence

**Date:** 2026-06-24 · **Decision:** DEFER (do not ship now) · **Artifact:** `ruby-value-ref.patch`

## What the patch is

An uncommitted, **tested, well-scoped** working-tree experiment found at session start
(`git diff` over `src/extraction/tree-sitter.ts` +146 / `__tests__/extraction.test.ts` +43).
It makes Ruby emit `references` edges from a method/constant/variable to the **constants it
reads** (a "value-reference" edge), correctly scoped (`Sinatra::Request::HEADER_PARAM`),
excluding definition sites, class/module name positions, and qualified-constant partials.

It is genuine, high-quality engineering. It is preserved verbatim in `ruby-value-ref.patch`
so the work is not lost; `git apply eval-results/value-ref-decision-2026-06-24/ruby-value-ref.patch`
restores it.

## Why it was deferred (evidence-consistent, not a quality judgement)

The prior raison-detre session handoff explicitly listed "sync the full upstream
value-ref patch?" as a **product decision that needs an A/B**, and states the
prior session ported only the *node* part (properties/constants), **not** value-ref edges. This
WIP was started after that handoff commit (`e4787bb`) — i.e. mid-experiment, contradicting the
handoff's own stated position. The decision was handed to this session; here it is, with reasons:

1. **Wrong category for OmniWeave's moat.** A Ruby constant-read reference is a *same-file,
   same-language standard edge*. The publication benchmark (`../omniweave-benchmark/RESULTS.md`)
   shows OmniWeave and codegraph are **identical** on standard edges across 11/14 languages, and
   that the structural-graph effort win in same-language code is **shared with codegraph, not
   unique to OmniWeave**. OmniWeave's only measured advantage is *cross-boundary* reachability
   (crossLang/invokes/S4). A value-ref edge does not cross any boundary.
2. **PARK P6.** "Nth edge kind / Mth language to win correctness = doesn't change the outcome."
   Correctness already ties everywhere; a new same-language edge kind moves no needle.
3. **Breaks global uniformity (spec §6).** It is Ruby-only. Value references, if adopted, must be
   a uniform cross-language decision, not a single-language one — otherwise the graph has two
   parallel paradigms (Ruby has value-refs, every other language does not).
4. **Trust cost.** Value-ref edges are high-volume and low-signal (one edge per constant read).
   The benchmark's honest framing of the Swift/Kotlin/Ruby node fixes specifically celebrated
   "no value-reference edges added (the trust model is unchanged)". Shipping them quietly for one
   language reverses that stance without the A/B the user requires ("错边比漏边危险").

## What would change the verdict

A cross-language A/B (real LLM, GT-locked) showing that same-file value-reference edges measurably
reduce an agent's reads/turns on "where is this constant/variable used?" questions **beyond what
`omniweave_search` + grep already deliver** — and that the added edge volume does not degrade
`explore`/blast-radius signal. Until that number exists, value references stay out of the trust
boundary. If adopted, do it uniformly across languages (port the full upstream patch), not Ruby-only.
