# Refactor-debt evaluation & disposition (2026-06-24, @ HEAD `2a24004`)

The war plan (`NEXT-SESSION-GENERAL-MOAT.md §2.5`) flagged three "discovered debt"
candidates. Each was evaluated against 奥卡姆 / 最小改动 / 错边比漏边 / "改它 agent
会变好吗?". Verdict: **all three DEFER/KEEP with evidence** — none changes an
agent-facing fact, and the highest-complexity area (`callback-synthesizer.ts`) is under
active concurrent edits this session (parallel-stream commits `7ab5931`, `2a24004`), so
a large mechanical refactor there is also a needless collision risk.

## 1. Split `callback-synthesizer.ts` (3825 lines) by family → **DEFER**

- **What**: ~60 internal `*Edges(...)` functions grouped into families (stores,
  framework-dispatch, native, workflow, react-native, R-S4). `c-fnptr` / `goframe` are
  already in their own files.
- **Benefit**: maintainer navigability only. **Zero** change to produced edges, output,
  or agent ROI.
- **Cost/risk**: large mechanical move in the single highest-complexity, hottest file;
  §4 涟漪 risk if a shared helper is missed; high collision probability with the active
  parallel stream editing the same area; full re-validation (synthesizer suites +
  `lang-parity` + eval gates) required for a no-op-to-the-product change.
- **Verdict**: DEFER. The file is *cohesive* (one concern: post-resolution edge
  synthesis), each function is small and well-named, and the aggregator
  (`synthesizeCallbackEdges`) reads as a flat manifest. 奥卡姆 + 最小改动: do not pay
  refactor risk for an organizational-only gain. Revisit only if a family grows its own
  multi-file helper set (as c-fnptr/goframe did) — extract *that family* in isolation,
  never a big-bang split.

## 2. `merged` dedup key `${source}>${target}` → `(source,target,kind)` → **DEFER**

- **Current**: `synthesizeCallbackEdges` dedups the synthesized batch by a **kind-blind**
  `source>target` key; `moduleVarReferenceEdges` (a `references` edge) is inserted
  **separately** (a documented one-liner) so it cannot be dropped by a same-pair `calls`
  edge. The `edges` table has **no** `(source,target,kind)` constraint (`id` autoincrement
  PK), and `insertEdge` does not dedup — the batch `seen` Set is the only dedup.
- **Proposed**: make the key kind-aware, fold module-var-ref back into the main array.
- **Assessment**: cleaner design *in principle* (matches the schema's lack of a (s,t)
  constraint and the trust model where different kinds are different facts). **But**: no
  edge is *currently* being wrongly dropped — the only known same-pair/different-kind
  collision class (references vs calls) is already handled by the separate insert; the
  change is cosmetic, touches the hottest file, and forces a full edge-count
  re-validation (`lang-parity` + every synthesizer fixture) for **zero** product/agent
  gain.
- **Verdict**: DEFER. The separate-insert workaround is correct and commented. Adopt
  `(source,target,kind)` only when a *future* synthesizer genuinely needs same-pair
  different-kind edges inside the main batch — then the change pays for its re-validation.

## 3. Skip indexing minified / generated bundles → **KEEP current design (no index-time skip)**

- **Current**: `isGeneratedFile` (`src/extraction/generated-detection.ts`, covers
  `.min.m?js`, protobuf/gRPC/mock codegen across 9 languages) is a **pure path classifier
  used for output DOWN-RANKING**, not a hard index filter. Generated nodes stay in the
  graph and remain reachable; they rank LAST and are excluded from module-var-ref
  synthesis (`callback-synthesizer.ts:3652`).
- **Why not skip at index**: (a) completeness — a generated API client / protobuf stub is
  sometimes the exact thing an agent must read; a blanket index-time skip *loses* that
  data. (b) The noise from minified bundles is **down-ranked NODES, not false EDGES** —
  the `lang-parity` adversarial drill-down already proved OmniWeave *refuses* to
  name-resolve single-letter minified calls (it is codegraph that fabricates those false
  positives; OW is the more precise one). 错边比漏边 is satisfied without an index-time
  skip. (c) `MAX_FILE_SIZE = 1 MiB` already drops the truly huge bundles before parsing.
- **Verdict**: KEEP. The "index everything, down-rank generated in output" split is the
  correct 冰山 design (completeness underneath, clean default surface on top). No change.

## Net

Refactor debt is **evaluated and consciously parked**, not ignored. The product/agent
surface is unaffected by all three; executing any of them now would be pure risk
(especially #1/#2 colliding with the concurrent stream) for no agent-ROI gain — the exact
"复杂度不是能力，是负债" / "改它 agent 会变好吗? 否 → 别改" discipline.
