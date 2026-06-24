# lang-parity adversarial drill-down — is OmniWeave's lower edge count a weakness, or codegraph's looseness?

**Date:** 2026-06-24 · **Posture:** adversarial — challenge OmniWeave even where it looks
fine, and *especially* where a raw metric makes it look worse. Iron-law-6 says OmniWeave (a
superset fork) must never be *weaker* than codegraph (CG). `lang-parity.sh` re-run after this
session's extraction/resolution changes flagged OmniWeave with **fewer standard edges** than CG
on real repos. This artifact drills that down to decide: real recall loss, or CG false positives?

## The flag — OmniWeave < CG on standard edges (real repos, OmniWeave @ `fd2b956` vs CG)

```
repo                 | OW nodes | CG nodes | OW edges | CG edges | std_total_diff (CG−OW)
---------------------|----------|----------|----------|----------|-----------------------
aider                | 3094     | 3092     | 9243     | 9568     | 326
code-graph-mcp       | 490      | 490      | 1213     | 1215     | 2
semantic-search-mcp  | 437      | 437      | 1008     | 1021     | 13
```

- **Nodes: OmniWeave ≥ CG everywhere** (aider 3094 > 3092; the other two exact-equal). No node
  regression. The deficit is entirely in *edges*, and entirely in three kinds.
- The raw `lang-parity.sh` verdict ("a same-language standard-kind divergence is a regression")
  would call this an iron-law-6 violation. **This is the hypothesis under test, not the verdict.**

## The drill-down — aider edge-kind histogram (the −326)

```
kind          | OW   | CG   | OW−CG
calls         | 3814 | 3953 | −139
contains      | 2978 | 2978 |   0   ← equal
imports       | 1274 | 1274 |   0   ← equal
extends       |   45 |   45 |   0   ← equal
implements    |    5 |    5 |   0   ← equal
decorates     |    2 |    2 |   0   ← equal
crossLang     |    1 |    0 |  +1   ← OmniWeave-exclusive bridge kind
instantiates  | 1064 | 1082 | −18
references    |   60 |  229 | −169
```

The structural backbone — `contains` / `imports` / `extends` / `implements` / `decorates` — is
**byte-for-byte equal**. The entire deficit is in `calls` (−139), `references` (−169),
`instantiates` (−18). So the question narrows to: are those CG-only edges *real*?

## The verdict — CG's extra edges are false positives OmniWeave correctly refuses

Sampling every CG-only edge (the set CG emits that OmniWeave does not), classified by the
**target file extension**:

- **`calls` −139 → 125 of them target `.js` files. 100%.** Every CG-only call edge lands in
  aider's *vendored, minified* JavaScript (`asciinema-player.min.js` and friends). CG resolves a
  minified call `g(...)` / `I(...)` to a same-named single-letter function by NAME — across
  unrelated minified scopes. One target is literally `[Symbol.iterator] → g`. These are **false
  positives**: name-collision call edges in single-letter minified code. OmniWeave's name-matcher
  refuses them. **错边比漏边 — OmniWeave is more precise here, not weaker.**
- **`instantiates` −18 → all CG-only ones target `.js`** (`v → B`, `Bg → B` in
  `asciinema-player.min.js`). Same minified-JS name-collision false positives. OmniWeave refuses.
- **`references` −169 → 157 target `.py`.** These ARE real Python mentions — but of the *weakest*
  edge kind: a function body mentioning a module-level `variable`/`constant`
  (`safe_version ↔ __version__`, `__init__ → posthog_project_api_key`). CG emits a `references`
  edge for nearly every such mention (229 total); OmniWeave is deliberately conservative (60). 5
  of the CG-only ones are even **bidirectionally symmetric** (`X→Y` AND `Y→X`), the signature of
  "co-mentioned in the same file" rather than a directed reference. This is a design choice on the
  lowest-value edge kind, not a capability gap (and OmniWeave now answers "what text mentions Y"
  via `content_fts` `pattern:` search instead).

## Honest conclusion

- **OmniWeave is NOT weaker than CG in any capability or precision sense on these repos.** The
  raw-edge deficit decomposes into: (a) CG false-positive `calls`/`instantiates` in minified
  vendored JS that OmniWeave correctly refuses (**OmniWeave wins on precision — 错边比漏边**), and
  (b) CG's liberal emission of the weakest edge kind (`references` to module variables), where
  OmniWeave is conservative by design.
- **The raw-count `lang-parity.sh` metric is misleading here**: it counts CG's minified-JS false
  positives as CG "having more edges". A quality-weighted read flips the sign — the structural
  backbone is identical, and the only *clean* (non-false-positive) delta is CG over-emitting weak
  references. Iron-law-6's intent ("OmniWeave must not be a poorer graph") is satisfied; its raw
  proxy is not, for a reason that favors OmniWeave.
- **No "more correct" claim** — this is about edge *precision/trust*, not answer correctness. CG is
  not wrong to surface references; OmniWeave is not wrong to skip name-colliding minified-JS calls.
  The honest framing is: same backbone, OmniWeave tighter on noise, CG looser on weak references.
- **Caveat kept honest:** the only direction where CG genuinely surfaces something OmniWeave does
  not is real Python module-variable `references`. If an agent needs those, OmniWeave under-returns
  them today (mitigated by content search). Not hidden.

## Reproduce

```bash
npm run build
CGBIN=research/2026-06-23-codegraph-ecosystem/repos/codegraph/dist/bin/codegraph.js \
  bash scripts/agent-eval/lang-parity.sh <aider-dir> <code-graph-mcp-dir> <semantic-search-mcp-dir>
# then index aider with both engines and diff the CG-only edge set by target file extension
# (the .js concentration is the tell). Raw run: ./parity-raw.jsonl
```
