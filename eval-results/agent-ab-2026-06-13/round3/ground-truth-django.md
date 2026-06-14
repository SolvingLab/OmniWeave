# Round 3 — django ground truth: callers of `iri_to_uri()`

Repo: django @ depth-1 clone (`/tmp/omniweave-corpus/django`), indexed by local dev build.
Graph: 3,005 files / 61,748 nodes / 196,028 edges (2,922 .py).

**Question (reverse whole-set + impact):**
> `iri_to_uri()` is defined in `django/utils/encoding.py`. List EVERY function/method that actually calls it (production + tests), file + calling-function. Exclude mere textual references (docstrings/comments/imports). Give total count.

## Verified ground truth = 17 real caller functions

Established by: OmniWeave `callers iri_to_uri -l 100 -j` (27 entries) cross-checked against
source via `grep -n 'iri_to_uri('` and reading each hit. OmniWeave's 27 = 17 real callers
+ 10 file-level nodes (its own noise — file nodes are NOT callers; with-arm must filter them).

### Production (12)
1. `django/contrib/flatpages/models.py:40` `get_absolute_url`
2. `django/contrib/syndication/views.py:15` `add_domain`
3. `django/http/request.py:226` `_get_full_path`
4. `django/http/request.py:263` `build_absolute_uri`
5. `django/http/response.py:642` `__init__` (HttpResponseRedirectBase)
6. `django/template/defaultfilters.py:225` `iriencode`
7. `django/templatetags/static.py:42` `handle_simple`
8. `django/utils/feedgenerator.py:89` `url`
9. `django/utils/feedgenerator.py:98` `__str__`
10. `django/utils/feedgenerator.py:113` `__init__`
11. `django/utils/feedgenerator.py:165` `add_item`
12. `django/utils/feedgenerator.py:289` `__init__`

### Tests (5)
13. `tests/admin_views/tests.py:4339` `test_changelist_to_changeform_link`
14. `tests/admin_views/tests.py:4379` `test_deleteconfirmation_link`
15. `tests/httpwrappers/tests.py:503` `test_redirect_url_max_length_checks_encoded_location`
16. `tests/utils_tests/test_encoding.py:155` `test_iri_to_uri`
17. `tests/utils_tests/test_encoding.py:204` `test_complementarity`

## Grep noise / traps (why this is a fair-but-sharp large-repo test)
- `grep 'iri_to_uri('` (excl. def) = **24 hits across 12 files** — counts call-LINES, not caller functions.
- **False-positive trap**: `django/utils/http.py:270` is a *docstring* (`Ensure to also use django.utils.encoding.iri_to_uri()`), NOT a call. A grep-only agent must read it to exclude it. OmniWeave correctly omits it.
- `feedgenerator.py` has **8 call-lines inside 5 methods** — grep line-count (8) ≠ caller-function count (5). Requires reading to collapse.
- Total grep textual hits for bare `iri_to_uri` = 37.

## Scoring rubric
- Complete = all 17 (or ≥ the 12 production + names the 5 test callers).
- Precise = excludes the http.py docstring FP; collapses feedgenerator's 8 lines → 5 methods.
- with-arm extra test: does the agent filter OmniWeave's 10 file-node entries? (health signal, cf. round-2 ky)
