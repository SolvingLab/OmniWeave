# Step D (output economy) — disposition (2026-06-24)

War plan §2.1 listed three output-economy levers. Evaluated against 奥卡姆 / PARK-table
shape-tax NO-GO / 站-agent-角度（没用则拒，不为凑数字）/ 错边比漏边. Outcome:

## D1 — provenance/confidence on every agent-facing surface → **LANDED + locked**

- **Gap (real)**: `callers`/`callees` rendered a *synthesized heuristic* `calls` edge
  (celery/sidekiq/pinia/rtk dispatch) with **no** trust note — an agent reading
  `callers(handler)` saw a guessed dispatch as a *certain, parsed call*, while
  `explore`'s relationship map and the node trail already showed `dynamic: …;
  confidence 0.NN`. That breaks the §4 trust model ("猜的才标 confidence" must surface
  on *every* surface, not just explore).
- **Fix**: `edgeLabel` now appends the same `synthEdgeNote` compact + confidence the
  explore map uses (deterministic structure edges — S4 overrides, parsed calls — stay
  unlabeled, as they must). Committed `2a24004`; locked by
  `framework-dispatch-synthesizer.test.ts` (asserts `callers(perform)` shows
  `dynamic: sidekiq dispatch` + `confidence 0.85`).
- *Note*: independently converged on by the concurrent work-stream this session; the
  committed version is the one in HEAD.

## D2 — deterministic tool ordering for KV-cache → **VERIFIED already satisfied (no change)**

- Tool list (`getStaticTools` → `toolsForSurface`) is a **fixed-order array filtered by
  Sets** → deterministic order across calls; the per-session explore description only
  varies with file count (a correct, real change, not nondeterminism).
- Every output `.sort(...)` uses a numeric comparator with tie-breakers; JS `Array.sort`
  is stable (ES2019+); SQLite result order on the same DB is deterministic. Repeated
  identical queries produce byte-identical output → KV-cache prefix stays warm.
- 奥卡姆: do not invent a fix for a non-problem. No change made.

## D3 — `explore` metadata-only / structure-only mode → **REJECTED (form-tax), documented**

- **Claim under test**: a zero-source "structure preview" mode would cut tokens.
- **Evidence against**:
  1. **Adoption ≈ 0** with the local driver. The new-edge agent A/B (real MiMo) shows
     **0 MCP calls in natural mode** across all arms (16/16 NE-rtk-hook cells: omniweave,
     codegraph *and* grep all `mcp=0`) — MiMo greps/reads regardless of attached tools,
     reproducing Step A's 0/36. A new mode nobody invokes is pure surface.
  2. **Marginal over existing knobs**: `explore` already (a) prints the candidate-graph
     breadth + relationship map + continuation keys *without* committing to source, (b)
     adaptively skeletonizes source for broad queries, and (c) honors `maxFiles` (1 ≈
     near-structure-only). A dedicated mode duplicates `maxFiles=1` for a few tokens.
  3. **PARK-table discipline**: "lower the fixed MCP/shape tax" is a recorded NO-GO
     (marginal omniweave fixed cost measured at +682 tok; the surface must not膨胀). A
     new mode/param *adds* schema surface — the opposite direction.
- **Verdict**: 站-agent-角度 "多出的东西有用不？" → no measured benefit, adds surface,
  duplicates an existing knob → **reject**, do not build "为凑数字". Output economy is
  already served by the adaptive budget tiers + `maxFiles` + the truncation-honesty work
  (CHECKPOINT P0 budget hardening) and now by D1's honesty (no over-claimed certainty).

## Net

Step D = **D1 landed (real honesty gap closed + locked) + D2 verified-satisfied + D3
rejected with evidence**. No new tool surface added; the one genuine defect (callers
hiding heuristic confidence) is fixed. This is the disciplined output-economy outcome,
not a checkbox build.
