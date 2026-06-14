# Round 4 — hand-verified ground truth (Track 1, structurally-ungreppable questions)

> Every entry cross-checked: `omniweave callers/callees/node/impact` + `grep`/read of the
> real source + direct SQLite (`.omniweave/omniweave.db`) edge inspection. Authoritative,
> enumerable, used to judge each A/B run full / partial / wrong.

## Q-(a) guava — runtime dispatch trap (`ImmutableSortedMap.reverseOrder()`)
**Question**: `reverseOrder()` returns `new Builder<>(Ordering.<K>natural().reverse())`.
What is the concrete (non-abstract) `Ordering` subclass stored in that Builder at runtime?

**Correct answer: `ReverseNaturalOrdering`.** Dispatch chain (verified by reading source):
- `Ordering.<K>natural()` → returns `NaturalOrdering.INSTANCE` (Ordering.java:170; NaturalOrdering is a concrete final subclass).
- `.reverse()` is a **virtual call on a `NaturalOrdering` receiver**. `NaturalOrdering` **overrides** `reverse()` (NaturalOrdering.java:70): `return (Ordering<S>) ReverseNaturalOrdering.INSTANCE;`
- So the stored comparator is `ReverseNaturalOrdering.INSTANCE`.

**The trap (wrong answer): `ReverseOrdering`.** The *base* `Ordering.reverse()` (Ordering.java:415)
returns `new ReverseOrdering<>(this)`. An agent that resolves `.reverse()` to the base
declaration (ignoring NaturalOrdering's override) answers `ReverseOrdering` — wrong.

**What each tool does (grounded):**
- **OmniWeave** `node reverseOrder` → `Calls → reverse (Ordering.java:415)` — i.e. it resolves
  `.reverse()` to the **base** `Ordering.reverse`, the **trap target**. OmniWeave's static edge
  is *potentially misleading* here (honest ceiling: it routes to a declaration, not the
  override-determined runtime target). The agent must still navigate to `NaturalOrdering`.
- **LSP** `goToImplementation`/`incomingCalls` would list all `reverse` overrides — can't pick
  the value-determined one either.
- **grep+read**: `grep reverse` → many defs; must read `natural()` → NaturalOrdering → its
  `reverse()` override. Multi-hop but reachable by a thorough agent.

## Q-(b) django — transitive blast radius (`escape_uri_path`, bounded to django/http/request.py)
**Question**: `escape_uri_path()` (django/utils/encoding.py) changes its output. Give the
COMPLETE transitive blast radius within `django/http/request.py`: every HttpRequest method
affected directly/indirectly + the call chain.

**Correct answer: 4 HttpRequest methods** (verified by `omniweave callers` hop-by-hop + grep):
- `_get_full_path` (request.py:226) — **direct** caller (`escape_uri_path(path)` @230).
- `get_full_path` (request.py:220) → `_get_full_path` (@221).
- `get_full_path_info` (request.py:223) → `_get_full_path` (@224).
- `__repr__` (request.py:80) → `get_full_path` (@81 and @86).
Chains: escape_uri_path → _get_full_path → {get_full_path, get_full_path_info} → (get_full_path) → __repr__.

**Boundary (must NOT be included as request.py methods)**: `get_full_path` has ~20 callers
**outside** request.py (middleware/views/tests) — out of scope for "within request.py".
`request.py:267` mentions `request.get_full_path()` in a **docstring** (not a call). The deepest
hop (`__repr__`, a dunder) is the one a shallow trace is most likely to miss.

## Q-(c) quarTeT — cross-process transitive scripts (AssemblyMapper run)
**Question**: running `quartet.py am`, which OTHER repo Python scripts execute as subprocesses,
directly or transitively? List each + the path.

**Correct answer: 2 scripts** (verified by `omniweave callees` + crossLang edges in DB + grep):
- `quartet_assemblymapper.py` — **direct**: `quartet.py:31` `subprocess.run(['python3', f'{sys.path[0]}/quartet_assemblymapper.py'] + parameter)`.
- `quartet_teloexplorer.py` — **transitive**: inside `AssemblyMapper()` at
  `quartet_assemblymapper.py:44` `subprocess.run(f'python3 {sys.path[0]}/quartet_teloexplorer.py … --noplot …', shell=True)` (telomere-check step).

**Boundary (must NOT be included)**: `quartet_gapfiller.py` / `quartet_centrominer.py` belong to
*other* subcommands, NOT the am path. `quartet_util.py` is `import`ed (module load), not a
subprocess. `quartet_util.py`'s own subprocess calls target **external binaries** (nucmer,
delta-filter, show-coords, minimap2/unimap, tidk, Rscript), not repo Python scripts.

**OmniWeave coverage (DB)**: 5 crossLang edges — `quartet.py → {assemblymapper, gapfiller,
centrominer, teloexplorer}.py` + `AssemblyMapper(fn) → quartet_teloexplorer.py`. The recursive
teloexplorer hop **is** captured. External tools (nucmer/minimap2) are **not** captured
(`invokes` fires only for Snakemake `wrapper:`, not raw subprocess) — honest gap.
