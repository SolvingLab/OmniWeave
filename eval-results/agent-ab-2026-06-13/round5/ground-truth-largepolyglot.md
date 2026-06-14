# Round 5 Track A — large-polyglot cross-process ground truth (hand-verified)

> Every entry cross-checked against the real clone + the OmniWeave index
> (`.omniweave/omniweave.db`) + grep of the source. Authoritative, enumerable,
> used to judge each A/B run full / partial / wrong.

## 0. Repo selection — the rigorous search (look-real, not assumed)

round4's only cross-process test was **quarTeT (7 files)** — too small to create
grep-noise / read-budget pressure. Track A's mandate: re-test on a **≥1,000-file**
real polyglot orchestration repo with a **real, enumerable, multi-hop** cross-process
chain (caller code → subprocess → in-repo sibling script → that script's
functions / a further subprocess), NOT a Snakemake `wrapper:`/`template` (OmniWeave
already handles those — not a grep-gap).

**15 candidates measured (treeless `git ls-files` for size, full clone + grep for the
chain) — every number is a real command, not a guess:**

| repo | total files | code | verdict |
|---|---|---|---|
| bcbio/bcbio-nextgen | 606 | 297 py / 1 R | <1000; cross-process = external tools via `do.run` dynamic strings |
| galaxyproject/galaxy | **8,155** | 2,408 py / 1,102 js-ts | ≥1000 but cross-process = job-runner templated command lines (dynamic) + `shell=True` cmd strings + SQL `conn.execute`; **no static sibling-script chain** |
| nipy/nipype | 1,870 | 1,348 py | wraps **external** neuroimaging binaries (FSL/ANTS) via CommandLine — not sibling repo scripts |
| su2code/SU2 | 2,553 | 99 py | C++ core; Python layer subprocesses compiled `SU2_CFD` binaries |
| CGATOxford/cgat | 1,813 | 483 py / 28 R | cross-process = `os.system(statement)` / `Popen(statement)` **dynamically-built** shell strings (ruffus `P.run`); `cgat <name>` dispatch via `glob`+`sys.executable` (dynamic) |
| I2PC/scipion | 394 | 238 py | <1000 (protocols live in separate plugin repos) |
| trinityrnaseq | 730 | 31 py / **413 pl** | Perl orchestrator — Perl callers not indexed by OmniWeave (nor more grep-followable) |
| Ensembl/ensembl-vep | 516 | 3 py / 82 pl | Perl |
| ganga-devs/ganga | 1,196 | 650 py | cross-process = `subprocess.run(f'cmt {command}')` / `os.system('rm -f %s')` dynamic strings; the one `Popen(['python', script_name])` uses a `tempfile.mktemp()` runtime path |
| microsoft/vscode | **11,538** | TS/JS | build/test infra: 1 real edge (`build/npm/update-all-grammars.ts` → `scripts/test-integration.sh`) — 1-hop, trivially greppable; rest spawn `process.execPath` with variable entrypoints |
| pybuilder/pybuilder | 1,045 | 962 py | plugin execution via imports, not subprocess |
| apache/mesos | 2,295 | 73 py | C++ |
| ansible/ansible | 5,765 | 1,818 py | module execution = ship-and-run with a **runtime-resolved** module path (dynamic) |
| liulab-dfci/**MAESTRO** | **1,729** | 46 py / 48 R | **CHOSEN** — ≥1000, real Python→R cross-language subprocess, enumerable (see §1). bio beachhead. |

**Finding (saturation-relevant, recorded honestly):** the clean **static** multi-hop
sibling-script cross-process chain that OmniWeave wins on (quarTeT) **does not occur at
≥1,000-file scale in the wild.** Large mature repos call internal code via **imports**
and reserve subprocess for **external binaries**, invoked through **dynamically-built
command strings** (cgat/ganga/galaxy) or **runtime-resolved paths** (ansible) — which are
the honest ceiling for grep *and* OmniWeave alike (neither can follow a string built at
runtime). The static-sibling-script idiom concentrates in **small/medium CLI tool suites**
(≤300 files), and the few large genomics orchestrators are **Perl** (trinity/vep), whose
callers OmniWeave doesn't index. This is itself a partial answer to "cross-process ×
large repo" (§ value-curve-v2): the cross-process win is a *small-repo* phenomenon, it
does **not** widen with scale the way same-language reverse queries do (round3).

## 1. MAESTRO — the enumerable cross-process chain (the A/B ground truth)

MAESTRO (single-cell RNA/ATAC pipeline): 1,729 tracked files (320 indexable code
files: 46 py + 48 R + vendored giggle C), Snakemake + Python + R.

**Question put to both arms:** *"List EVERY R script in this repo that the Python
pipeline code executes as a subprocess (via `Rscript`), with the Python file:line that
launches each. Exclude R scripts that are only `source()`d / library-loaded, and exclude
any runtime-generated temp script."*

**Correct answer — exactly 2 scripts** (verified by grep + reading every `os.system`/
`subprocess` site + the R/ dir):

1. **`MAESTRO/R/scRNAseq_qc_filtering.R`** ← `MAESTRO/scRNA_QC.py:150`
   `cmd = "Rscript %s/scRNAseq_qc_filtering.R --prefix %s …" % (RSCRIPT_PATH, …)` then `os.system(cmd)` (:151).
2. **`MAESTRO/R/scATACseq_qc_filtering.R`** ← `MAESTRO/scATAC_QC.py:139`
   `cmd = "Rscript %s/scATACseq_qc_filtering.R --prefix %s …" % (RSCRIPT_PATH, …)` then `os.system(cmd)` (:140).

`RSCRIPT_PATH = resource_filename('MAESTRO', 'R')` (scRNA_utility.py:13) → the installed
`MAESTRO/R/` package-data dir.

**Boundary — must NOT be listed:**
- `scRNA_AnalysisPipeline.py:236` `cmd = "Rscript %s" % rscript` → `rscript` is a
  **runtime-generated temp file** written by `GenerateRscript()` (a `tempfile`/`outprefix`
  path), NOT a repo script. Listing it is WRONG.
- `R/integrate.R`, `R/scRNAseq_pipe.R`, `R/scATACseq_pipe.R`, `R/scRNAseq_qc.R`,
  `R/scATACseq_qc.R` exist but are **`source()`d sub-scripts** of the pipe scripts /
  library code, not directly `Rscript`'d by Python. Listing them is WRONG.
- the many `os.system("bedtools …")` / `os.system(cmd)` calls target **external binaries**
  (bedtools/macs2/samtools) or dynamic strings — not repo R scripts.
- 1 hop only: neither `scRNAseq_qc_filtering.R` nor `scATACseq_qc_filtering.R` launches a
  further subprocess (verified — no `system()`/`system2()`/`Rscript`/`source` of another
  script inside them); the correct 2nd-hop answer is "none".

## 2. What each tool does on this question (grounded)

- **OmniWeave** (dev build 0.1.0, MAESTRO indexed): **0 `crossLang` edges** for these
  calls (DB: only Snakemake `produces` 421 / `consumes` 395 from the `.smk` DAG). The
  raw `os.system("Rscript %s/x.R")` is at OmniWeave's **honest ceiling, twice over**:
  (a) the `%s` Python old-style-format dir-prefix isn't in the `SCRIPT_PATH` interpolation
  set (only f-string `{…}/`, `${…}/`, `$var/` are stripped), and (b) even stripped, the
  basename resolves relative to the *caller* dir (`MAESTRO/MAESTRO/`) while the script
  lives in `MAESTRO/R/` — `RSCRIPT_PATH` is a runtime `resource_filename(...)` value, so
  the directory is genuinely not statically knowable without dataflow. The R files **are**
  indexed as `file` nodes, so `omniweave search scRNAseq_qc_filtering` finds them by name —
  but there is **no navigable edge** from the Python QC code to them. So with-arm has **no
  1-call cross-process win here**; it degrades to search+read ≈ grep. *Recorded honestly:
  this is the design's stated routes-to-declaration / no-dataflow ceiling, not a bug to
  rush-fix at the marathon tail (cf. STATUS §0.17).*
- **grep+read**: `grep -rn "Rscript" .` across 1,729 files → the 3 call sites (2 real + 1
  temp) → read scRNA_QC.py / scATAC_QC.py / scRNA_AnalysisPipeline.py to classify → read
  R/ to confirm leaf. Reachable by a thorough agent; the work is reading + boundary
  judgement.
- **LSP**: **categorically blind** — the Python→R link is an `os.system` **string**; no
  symbol spans it, the target is another language, and no R language server is configured.
  `findReferences`/`incomingCalls` on the R script return nothing across the boundary.
