# Round 5 Track B — mixed-question-set ground truth (for judging routing before/after)

Mixed set spans 4 query shapes × multi-language × multi-repo. Each answer hand-verified
against the indexed DB + source.

## Q1 — single-point, TS (ky)
**Q:** Where is the `HTTPError` class defined (file:line), and what args does its constructor take?
**GT:** `source/errors/HTTPError.ts:15`; constructor `(response: Response, request: Request, options: NormalizedOptions)`. (extends `KyError`.)

## Q2 — single-point, R (DESeq2)
**Q:** Where is `nbinomWaldTest` defined (file:line) and its full signature?
**GT:** `R/core.R:1333`; `nbinomWaldTest(object, betaPrior=FALSE, betaPriorVar, modelMatrix=NULL, modelMatrixType, betaTol=1e-8, maxit=100, useOptim=TRUE, quiet=FALSE, useT=FALSE, df, useQR=TRUE, minmu=0.5)`.

## Q3 — reverse callers, Python (django)
**Q:** Every function/method that calls `iri_to_uri` (django/utils/encoding.py).
**GT (DB-confirmed, 17 distinct callers across 12 files):**
get_absolute_url (flatpages/models.py:49), add_domain (syndication/views.py:21),
_get_full_path (http/request.py:233), build_absolute_uri (http/request.py:300),
__init__ (http/response.py:651), iriencode (template/defaultfilters.py:227),
handle_simple (templatetags/static.py:48), url+__str__+several __init__/add_item
(utils/feedgenerator.py:90,100,148,153,156,197,292), + 4 test callers
(admin_views/tests.py, httpwrappers/tests.py, utils_tests/test_encoding.py).
A full answer lists the ~13 non-test production callers + notes the tests.

## Q4 — transitive blast-radius, Python (django) [round4 GT]
**Q:** Complete transitive blast radius of `escape_uri_path` WITHIN django/http/request.py.
**GT: 4 HttpRequest methods** — `_get_full_path` (:226, direct), `get_full_path` (:220),
`get_full_path_info` (:223), `__repr__` (:80, deepest). Chain: escape_uri_path →
_get_full_path → {get_full_path, get_full_path_info} → (get_full_path) → __repr__.
Boundary: `get_full_path`'s ~20 callers OUTSIDE request.py are out of scope; the :267
docstring mention is not a call.

## Q5 — cross-process, Python (quarTeT) [round4 GT]
**Q:** Running `quartet.py am` (AssemblyMapper), which OTHER repo Python scripts execute
as subprocesses, directly or transitively?
**GT: 2 scripts** — `quartet_assemblymapper.py` (direct, quartet.py:31 subprocess) +
`quartet_teloexplorer.py` (transitive, quartet_assemblymapper.py:44 subprocess in the
telomere-check branch). Boundary: gapfiller/centrominer belong to other subcommands;
quartet_util.py is imported (not subprocessed); its tool calls target external binaries.
OmniWeave DB: crossLang edges `quartet.py→{assemblymapper,gapfiller,centrominer,
teloexplorer}.py` + `AssemblyMapper→teloexplorer.py` (the recursive hop IS captured).

## Routing expectation (the Pareto claim)
- **Q1/Q2 (single-point):** routing should drop the with-arm from explore-heavy to a single
  `omniweave_search` (or grep) → form-tax shrinks toward the without-arm.
- **Q3/Q4/Q5 (reverse/transitive/cross-process):** routing must NOT regress — with-arm
  keeps using callers/impact/explore and stays at its round3/4 win level.
