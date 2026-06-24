# OmniWeave's raison d'être — an evidence-based answer

**Date:** 2026-06-24 · **Status:** answer to the headline existential question ·
**Method:** evidence-first (real commands / real source / the committed benchmark),
plus an adversarial multi-perspective workflow (`debate.md`).

> **The question (verbatim from the handoff).** The publication-grade benchmark
> tested OmniWeave (OW) against upstream codegraph (CG) and grep and found: agent
> **correctness ties on all 6 questions × 66 runs**; **node extraction ties CG on
> 11/14 languages**; OW's **only** structural delta (4 bridge edge kinds + the S4
> dispatch graph) **appears only in bio/polyglot/workflow** scenarios. *If OW ties
> CG everywhere that matters generally, what is its reason to exist? Why develop and
> maintain an independent fork?* Options: (a) find/build a wider general
> differentiator; (b) accept a niche and position honestly; (c) reframe the value
> entirely; (d) honestly conclude the increment doesn't justify the fork.

---

## 0. TL;DR — the honest answer

OmniWeave's reason to exist is **real but narrow, and it must not be sold as more
than it is.** Stated without inflation:

1. **There is no defensible *general* moat over codegraph.** On the 12 standard edge
   kinds across 14 languages the two graphs are the same shape; agent correctness
   ties; the same-language structural-retrieval effort win (reverse/blast-radius) is
   a property of *having a graph at all* — codegraph has it too. So as a "generally
   stronger codegraph," OW does **not** justify itself. (Evidence: §2.)

2. **There is a real, bounded, scenario-specific delta** — 4 cross-boundary edge
   kinds (`crossLang`/`produces`/`consumes`/`invokes`) and an S4 dispatch graph
   (773 method nodes + 221 `overrides` edges) that codegraph's type system literally
   cannot represent — and it converts to measurably lower agent **effort** exactly on
   cross-language / cross-process / workflow / dynamic-dispatch questions, widening as
   the model weakens. This is **not correctness** and it is **not everywhere**. It is
   the user's actual domain (R/S4 Bioconductor + Snakemake/Nextflow + polyglot
   pipelines). (Evidence: §2, benchmark Part B/C.)

3. **The wider-general-differentiator path (option a) has no benchmark-grade evidence yet.**
   The one candidate not already in the PARK table — build-orchestration bridge edges
   (Makefile / `package.json` scripts / Dockerfile / CI → local scripts) — has only a
   mixed pilot scan recorded in this artifact. It should not be used as either a formal
   NO-GO or a moat until upgraded into a benchmark artifact with corpus manifest,
   semantic classification, GT questions, and A/B. The current evidence-backed posture
   is simply: do not invest in width without a new A/B that contradicts the PARK table.
   (§3.)

4. **The trust/honesty/distribution layer is OW's largest *investment* but is
   currently *unproven* as a moat.** No head-to-head trust A/B vs codegraph exists;
   round 7 already conceded snapshot-suppression is not a moat vs a gitignore-aware
   grep. Calling it a moat today would be exactly the overclaim the user forbids. It
   is excellent **hygiene**; it becomes a **moat** only if a measurement shows CG
   misleads an agent where OW does not. (Evidence: §4.)

**Verdict: (b) sharpened, operated as (c); (d) rejected — conditionally.**
OW is *the code graph for polyglot/workflow/dispatch-heavy codebases*, maintained as
a **thin differential fork that tracks codegraph upstream**. This is justified **for
this user** because it is their daily domain and the effort win there is real and
reproducible. It is **not** justified as a general-purpose "better codegraph," and the
README must keep saying so (it already does). If the user ever stops working on
polyglot/workflow/bio code, the honest call flips to (d).

The distinction that carries the whole answer: **personal/domain utility ≠ defensible
general moat.** OW has the first. It does not have the second. Conflating them would be
失信; this document keeps them apart.

---

## 1. What was actually established (the starting point)

From the committed publication benchmark (`../omniweave-benchmark/RESULTS.md`) and 7
prior A/B rounds:

| Claim | Status | Source |
|---|---|---|
| Agent correctness OW vs CG vs grep | **ties** (6 Q × 66 runs, 0 INVALID) | Part C1 |
| Node extraction OW vs CG | **11/14 exact parity**, 3 residual ≤7-node drift | Part A |
| OW's structural delta | 4 bridge edges + S4 dispatch only | Part A/B |
| Bridge edges in single-language repos | **0 in all 14** — delta is scenario-specific | Part A2 |
| Measured advantage | **effort** (turns/tool-calls), not correctness; widens as model weakens | Part C2 |

So the premise of the question is correct and confirmed: *OW = CG on everything that a
general coding agent meets most of the time.*

---

## 2. Option (a.1) — is the existing structural delta a general moat? **No.**

The bridge edges + S4 dispatch are genuinely things CG cannot hold (CG's `EdgeKind`
union is 12 kinds; none of `crossLang`/`produces`/`consumes`/`invokes`; CG collapses
`setMethod(g, signature(Class), …)` into a bare `function`). On the polyglot/workflow
corpus OW carries **2104 bridge edges** and **773 method / 221 overrides** that CG
shows as 0 (`results/structural-capability-matrix.json`).

But this is **not a general moat** for three reasons the evidence forces:

- **It is zero in every single-language repo** (Part A2). General codebases are
  overwhelmingly single-language; for them OW = CG.
- **The win is effort, not correctness** (Part C1/C2). A capable agent reaches the
  same answer with grep; OW just spends fewer turns — and only on cross-boundary
  questions (Q3 workflow: 16 vs 36 turns; weak model 12 vs 45).
- **The general-purpose effort win OW *does* have at scale (reverse/blast-radius) is
  shared with CG** — it comes from having a structural graph at all, which CG also
  has. It is not a *delta* over CG.

**One delta inside the delta is durable; the rest is scale-sensitive.** The adversarial
review (§8) sharpened this: the **S4 dispatch advantage does not evaporate with repo
size** — `setMethod` structure is a property of the Bioconductor *package*, not of file
count, and CG's type system genuinely cannot hold an `overrides` edge at any scale. By
contrast, the **workflow/cross-process advantage is scale-sensitive and only partly
proven**: the node-count gap (nf-core/sarek 745 vs 41) is structural evidence, but the
only agent-**effort** A/B (Q3: 16 vs 36 turns) was on a *small* pipeline fixture, and
PARK P1 records the cross-process effort win *evaporating to a tie at MAESTRO scale
(1729 files)*. So "workflow blindness" is a real node-extraction gap but is **not yet
converted to a turn/tool-call number at the scale where it would matter most** — do not
present it as a measured effort moat there.

**Conclusion:** the structural delta is a real **domain** advantage, not a general one;
within it, **S4 dispatch is the non-evaporating core** and workflow/cross-process is a
bounded, partly-unproven-at-scale edge. This is option (b), honestly stated. It is not
option (a).

---

## 3. Option (a.2) — is there a *wider* differentiator CG lacks? **Not proven.**

The PARK table (`../../CHECKPOINT.md`) has already closed the obvious wide axes on
evidence: cross-process×large-repo (NO-GO), vertical bio tables (NO-GO), lowering the
fixed shape tax (only +682 tok marginal — NO-GO), in-process mode (NO-GO),
prompt-routing (ceiling), Nth-edge-for-correctness (doesn't move the needle). Reopening
any of those without a new contradicting A/B is forbidden — and nothing here does.

The **one candidate not in the PARK table** was **build-orchestration bridge edges**:
OW's workflow extractor handles only `.smk`/`.nf`/`Snakefile` (bio-specific). Makefile /
`package.json` scripts / Dockerfile / CI-YAML → local-script edges are *absent*. These
are domain-agnostic — every repo has build orchestration — so if they formed
traversable multi-hop chains, that would be a genuinely *wider* moat.

**Pilot scan recorded here, not a publication-grade benchmark.** The scan is mixed:
most sampled repos have 0-2 local-script references from orchestration files, while two
tooling-heavy repos have 20-25 mostly plugin/packaging test-script references. Raw regex
edge counts alone do not establish a traversal moat or a NO-GO:

| Repo | Orchestration files | Distinct local-script edges they'd create |
|---|---|---|
| aider | 10 CI workflows + 3 Dockerfiles | **1** (`scripts/issues.py`) |
| cgc | 12 CI workflows + 1 Dockerfile + 1 Makefile + 4 package manifests | **2** indexing scripts |
| code-graph-mcp-2 | 4 CI workflows + 6 package manifests | **25** plugin test/release scripts |
| codebase-memory | 14 CI workflows + 6 Dockerfiles + 4 package manifests | **20** mostly test/tool scripts |
| blarify / claude-context / codanna variants / serena / others | CI/package manifests | usually **0-2** |

**Verdict: defer, do not productize.** This is enough to prevent opportunistic
implementation, but not enough to declare a formal benchmark result in either direction.
A real decision would need the same artifact standard as
`eval-results/omniweave-benchmark/`: corpus manifest, semantic classification of which
script references are actually useful to an agent, GT-locked questions, and an A/B
proving lower effort. Until then, build orchestration remains a plausible but unproven
width candidate, not a shippable moat.

*Reproducibility:* the scan is committed — `probe-build-orchestration.sh <repos-dir>` →
`build-orchestration-scan.txt` (18 repos: median 0, 16/18 ≤2 edges; the two outliers are
depth-1 `package.json`→test-script references, not multi-hop chains). Re-run it on a larger
corpus before treating the direction as settled.

This leaves option (a) unsupported: there is no committed evidence of a wider general
differentiator strong enough to justify widening OmniWeave beyond the existing
bio/polyglot/workflow/dispatch lane.

---

## 4. Option (c) — reframe: is the trust/distribution layer the real value?

The *bulk of OW's commits* are not edges — they are a trust/honesty/distribution layer:
provenance + confidence layering (deterministic S4 edges carry no confidence; heuristic
`crossLang` carry 0.7–0.95), fail-closed snapshot/SCIP import boundaries, the daemon
**build-fingerprint rendezvous** (a rebuilt client refuses to be served stale code by an
old daemon — the "the tool lied to me" failure, fixed), and ~70 commits of output-honesty
hardening (no competitor-snapshot dumping, honest truncation/empty/stale states).

This is the most *defensible reframe* of "why OW," **but it is currently unproven as a
moat**, and honesty requires saying so plainly:

- Round 7 explicitly recorded that snapshot-suppression is **not** a moat versus a
  gitignore-aware grep — it fixed OW having been *dirtier* than grep, i.e. it removed a
  self-inflicted deficit rather than beating a competitor.
- **No head-to-head trust A/B vs codegraph exists.** Nobody has measured whether CG
  dumps snapshots, serves a stale daemon, or fabricates edges where OW does not.

So the trust layer is, today, **hygiene OW holds itself to**, not a demonstrated
competitive advantage. It *could* become a moat — that is the single most valuable open
experiment (§6) — but until the number exists, it is described as hygiene. Calling it a
moat now would be the precise overclaim the spec forbids.

---

## 5. Option (d) — does the increment justify an independent fork?

**Conditionally rejected.** The honest cost/benefit:

- **Cost.** A fork is not free. This session itself caught OW having silently drifted
  *behind* its own base on Swift/Kotlin/Ruby node extraction — a superset fork that had
  become a non-superset. Maintaining "OW ≥ CG everywhere" requires periodically
  re-absorbing upstream's safe additive wins. That is real, recurring labor.
- **Benefit.** For a user whose daily work *is* R/S4 + Snakemake/Nextflow + polyglot
  pipelines, the bridge-edge/S4 delta is used constantly and the effort win is real and
  reproducible. That is a sufficient reason to keep the fork **for this user**.

Therefore (d) is the correct answer **only in the counterfactual** where the user stops
needing polyglot/workflow/dispatch analysis. As long as that domain is live, the fork is
justified — but justified by *personal/domain utility*, not by a general market moat.
The document refuses to dress the second up as the first.

---

## 6. Recommendation — operate (b) as a differential-tracking fork

1. **Keep the README's honest framing** (it already says "not more correct, not a
   universal win, the most economical form for one specific intersection"). Do not let
   any doc/CHANGELOG/steering drift toward "better/more-correct than codegraph."
2. **Maintenance posture = thin differential fork.** Treat codegraph as upstream.
   Continuously absorb its safe, additive extraction wins (the fork-drift detector is
   `harness/lang-parity.sh`; run it after any extraction change). Maintain only the
   differential: the 4 bridge edges, the S4 dispatch graph, and the trust/distribution
   layer. This is the lowest-cost way to stay ≥ CG without re-deriving CG.
3. **Do not invest in width without a paper-grade A/B.** The PARK directions are closed;
   build orchestration is only a pilot observation; do not add the Nth edge kind or Mth
   language hoping for a moat (P6). New capability should target the *cross-boundary*
   intersection where the delta is already real, or bring its own Methods+Results.
4. **Settle the value-reference decision as deferred** (`../value-ref-decision-2026-06-24/`):
   same-language value-ref edges are the Nth-edge path (P6), break cross-language
   uniformity if done per-language, and add low-signal volume against the trust model —
   out until a cross-language A/B says otherwise.

## 7. The experiments that could still change the verdict

From the adversarial workflow (§8), in priority order:

1. **Large-scale workflow effort A/B** (most important for the niche justification): run
   the Q3 workflow/invokes question on **nf-core/sarek** (745 nodes, hundreds of rules)
   instead of the small fixture. PARK P1 records the cross-process win evaporating at
   MAESTRO scale — so the open question is whether the workflow node-gap (745 vs 41)
   converts to a *proportional effort* number at scale or also evaporates. Until then,
   workflow blindness is a node-extraction gap, not a measured effort moat at scale.
2. **Trust A/B vs codegraph on the stale-daemon scenario**: rebuild both tools, query
   without restarting the daemon, measure whether CG serves stale results while OW
   detects the skew via build-fingerprint and serves fresh code. This is the one
   experiment that turns the daemon-fingerprint claim from architecture into behavior.
3. **CG snapshot/gitignore test**: index OW's own repo with CG, run the missing-symbol
   query that once made OW dump 24K of competitor snapshots. If CG also respects
   `.gitignore` (likely), the snapshot-suppression delta collapses entirely — confirming
   it was never a moat over CG, only a repair of OW's own prior dirtiness.
4. **S4 effort at Bioconductor scale**: re-run Q1 on S4Vectors (500 method / 195
   overrides) — the small-fixture 9.3-vs-15.3 turn win may widen (CG's naming-convention
   compensation degrades) or hold ratio. State the S4 win as *directional*, not a fixed
   multiplier, until measured at scale.
5. **Cross-family weak-model replication** (benchmark Limitation 1): the "widens as model
   weakens" trend is two MiMo tiers; a different family (small Qwen/DeepSeek) would show
   whether it is architectural or model-family-specific.

Absent those numbers, the verdict in §0 stands: **a real, narrow, domain/personal
reason to exist — honestly bounded, never inflated into a general moat.**

## 8. Adversarial verification (the workflow)

The verdict was stress-tested by a 5-agent adversarial workflow (full transcript:
`debate.md`): three advocates argued **(d) archive**, **(b) niche**, and **(c) reframe**
at full strength; a red-team attacked the weakest claim in each; a synthesizer produced
the honest verdict. What survived contact with the evidence:

- **Best surviving position: "(b) with the discipline of (d)'s conditional"** — exactly
  the §0 verdict, reached independently. The niche delta (S4 + bridge edges) is grounded
  in numbers no advocate disputed; (d)'s archival conclusion is too strong because the S4
  delta is non-evaporating and the user is literally an R bioinformatician; (c)'s trust
  reframe is philosophically right but its most concrete claimed advantage collapsed.
- **A concrete overclaim was caught and verified false** — the kind of finding this whole
  exercise exists to produce. The reframe advocate claimed OW's explore hard-caps at 25K
  while CG "externalizes at 35–38K." The red-team read CG's *actual* source and found CG
  caps at `Math.min(budget*1.5, 25000)`. I verified it directly:
  `research/.../codegraph/src/mcp/tools.ts:3324` is `Math.min(Math.round(budget.maxOutputChars * 1.5), 25000)`;
  OW's `src/mcp/tools.ts:66` is `EXPLORE_INLINE_HARD_CEILING = 25_000`. **Identical.** The
  35K figure came from a stale CLAUDE.md table, not running code. This is a textbook
  example of a trust-layer "moat" that is actually parity — and why §4 keeps the trust
  layer labelled *hygiene, not moat*.
- The red-team also flagged that the **workflow node-gap is not yet an effort number at
  scale** (folded into §2/§7) and that **daemon-fingerprinting is architecture, not a
  measured behavioral win** (folded into §4/§7).

## 9. Honesty caveats — the non-claims (load-bearing)

These are the statements OmniWeave's docs, CHANGELOG, and steering must **never** make.
They are the operational form of "packaging a non-existent moat = 失信":

1. **Never** claim OW is *more correct* than codegraph or grep. Correctness tied on all 6
   GT-locked questions across 66 runs and 7 rounds. This is the single most important non-claim.
2. **Never** claim a *general* moat for arbitrary codebases. Bridge edges are structurally
   zero on all 14 single-language repos; the differentiation is scenario-specific.
3. **Do not** claim an explore-ceiling advantage (OW 25K vs CG "35–38K"). CG caps at the
   same 25K (verified, §8).
4. **Do not** claim snapshot-suppression as a moat over CG or grep — it repaired OW from
   being *dirtier* than grep, not from being cleaner than CG (round 7).
5. **Do not** claim the cross-process/`crossLang` win generalizes to large repos — it
   parks at MAESTRO scale (PARK P1). The Q3 win is on a small-to-medium fixture.
6. **Do not** claim daemon-fingerprinting is category-unique without a head-to-head A/B
   showing CG actually serves stale results where OW does not (CG has its own stale-index
   machinery).
7. The S4 effort win (9.3 vs 15.3 turns) is a *directional* win measured on a small
   fixture (CG compensates via R naming-convention leaks), not a fixed multiplier.
8. Build-orchestration bridge edges are only a mixed pilot observation here. Do not cite
   them as a closed NO-GO or as a new moat until a full benchmark artifact and A/B
   results are committed.

## 10. The maintenance recommendation, operationally

From the synthesis, the posture that follows from the verdict:

1. **The maintained differential is three bounded units** and nothing else: the S4
   dispatch logic (`src/extraction/languages/r.ts` + `callback-synthesizer.ts`
   `rS4DispatchEdges`), the workflow extractor (`src/resolution/frameworks/workflow.ts` +
   `.smk`/`.nf` grammar mapping), and the trust/honesty output layer. Everything else is
   inherited and kept at parity.
2. **Formalize upstream tracking.** Run `harness/lang-parity.sh` on a cadence (and after
   any upstream extraction change). The Swift/Kotlin/Ruby drift this session is the proof
   that skipping this makes a "superset" fork silently fall *behind* its base.
3. **Keep all public framing honest** (README already does): "OW adds S4 dispatch + workflow
   DAG edges for bio/polyglot/workflow codebases; on single-language repos it is equivalent
   to codegraph." Zero "more correct," zero "general moat."
4. **Do not contribute the differential upstream as the primary strategy** — that would
   eliminate the fork's reason to exist. Keep the fork, track upstream. **If codegraph ever
   ships native workflow-grammar or S4-dispatch support, re-evaluate immediately** — that is
   the event that flips the verdict to (d).
5. **Settle value-references as deferred** (`../value-ref-decision-2026-06-24/`).
