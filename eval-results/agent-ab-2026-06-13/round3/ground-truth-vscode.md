# Round 3 — vscode ground truth: callers of `TextModel.getDecorationRange()`

Repo: microsoft/vscode @ depth-1 clone (`/tmp/omniweave-corpus/vscode`), local dev build.
Graph: **11,538 files / 333,804 nodes / 1,527,558 edges** (10,854 .ts). Index time 4m38s.

**Question (reverse whole-set + impact, interface dispatch, ~3× django scale):**
> `getDecorationRange()` concrete impl = `TextModel.getDecorationRange` in
> `src/vs/editor/common/model/textModel.ts`. List EVERY function/method that calls it
> (prod + tests), file + calling function. Exclude interface declarations & type refs.
> Give total count + which editor subsystems depend on it.

## Structure (interface dispatch — grep finds call sites, must know TextModel is the impl)
- **2 interface declarations** (NOT callers): `src/vs/monaco.d.ts:2264`, `src/vs/editor/common/model.ts:1114`
- **Concrete impl**: `TextModel.getDecorationRange` @ `src/vs/editor/common/model/textModel.ts:1798`
- (`_getDecorationRange` in notebookViewModelImpl.ts is a DIFFERENT private method — not this.)

## Verified ground truth
- **Real call sites** `\.getDecorationRange(` = **71 call-lines across 26 files**.
- **OmniWeave structural callers** = **51 caller functions across 25 files** (+1 file-node noise).
  - call-lines (71) > caller-functions (51): some functions call it 2+ times (same as django).
- **Subsystems** (verified via path): editor/common (viewModel), editor/browser, contrib/{find,snippet,codelens,suggest,linkedEditing,inlayHints}, workbench, plus test fixtures (copilot sim fixtures, modelDecorations.test.ts).

## Why this is the scale stress test
- django (large-repo #1) had 17 callers / 24 grep hits / 18 reads — grep stayed COMPLETE by brute force.
- vscode here: 51 callers / 71 call-lines / 26 files — **~3× the read burden**. Tests whether the
  grep+read brute-force budget breaks at extreme scale, or just gets more expensive.
- grep `\.getDecorationRange(` is greppable (unique-ish name) → noise ratio low → expect grep to stay
  complete-but-expensive, OR start sampling/missing at this file count. Measured by the A/B.

## Scoring rubric
- Correct impl identified: `TextModel.getDecorationRange` (not the interface decls).
- Completeness: count near 51 caller functions / 71 call-lines / 26 files; subsystem list covers find/snippet/codelens/suggest/viewModel.
- with-arm: filters the 1 file-node; does it get enclosing-class attribution right? (cf. django gap — callers omits qualified_name.)
- Honest call: did grep stay complete (just expensive) or did it MISS/sample at this scale?
