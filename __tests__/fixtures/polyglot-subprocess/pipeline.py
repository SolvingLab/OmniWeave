"""A plain Python orchestrator (NOT a workflow file) that shells out to an R
script and another Python script across the process boundary. Today the call
graph dead-ends at these calls — no LSP resolves Python -> R, and grep can't
follow the hop. generalCrossLangEdges synthesizes the crossLang edge from the
calling function to the target script."""
import subprocess
import os


def run_analysis(counts, out):
    # Modern array form — the safe, idiomatic subprocess invocation.
    subprocess.run(["Rscript", "scripts/deseq.R", counts, out], check=True)


def make_report():
    # Flat-string form via os.system.
    os.system("python scripts/report.py --format html")


def bare_ref():
    # Precision negative: a script path in a bare string with no subprocess call
    # in context must NOT produce a crossLang edge (the hard subprocess-call gate
    # skips it even though scripts/deseq.R exists in the corpus).
    note = "to reproduce, run Rscript scripts/deseq.R by hand"
    return note


def dynamic(script_path):
    # Honesty ceiling: the path is a variable, not a literal — never guessed.
    subprocess.run(["python", script_path])


def run_via_check_call():
    # Recall: subprocess.check_call is as common as .run — its array form must edge
    # just like .run/.Popen (an adversarial probe caught `check_call` being missed).
    subprocess.check_call(["python3", "scripts/report.py", "--strict"])


def echo_not_run():
    # PRECISION NEGATIVE: `echo` prints the command; the interpreter is an argument
    # to echo, not the invoked process. Must NOT mint a crossLang edge even though
    # scripts/deseq.R exists in the corpus (the command-boundary gate rejects it).
    os.system("echo Rscript scripts/deseq.R to reproduce")


def straddle_negative():
    # PRECISION NEGATIVE: a real subprocess call, then a BARE string two lines down
    # that merely names an interpreter+path. The bare string must not borrow the
    # earlier call's subprocess token — the look-back is bounded at the closing `)`.
    subprocess.run(["true"])
    msg = "python scripts/report.py"
    return msg
