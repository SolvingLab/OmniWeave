"""A multi-subcommand dispatcher — the dominant real-world Python-CLI idiom
(e.g. quarTeT's quartet.py, which shells out to four sibling sub-tools). It
addresses its sibling scripts by a 'this-directory' interpolation prefix:
f'{sys.path[0]}/x.py' or f'{os.path.dirname(__file__)}/x.py'. The directory is
interpolated but the basename is static and the file is a real sibling, so the
cross-process hop IS statically resolvable. Pre-fix recall on this shape was 0:
the f-string prefix broke the array regex, and cleanScriptPath stripped only
shell '${var}/' interpolation, not Python '{...}/'. This is the exact pattern
the quarTeT real-repo recall test surfaced (5/5 of its positives looked like
this)."""
import subprocess
import sys
import os


def dispatch_array(args):
    # Array form with an f-string 'this dir' prefix — quarTeT's quartet.py shape.
    subprocess.run(["python3", f"{sys.path[0]}/tool_sub.py"] + args)


def dispatch_string(sample):
    # Flat-string form with __file__-dir interpolation, run via shell=True.
    subprocess.run(f"python3 {os.path.dirname(__file__)}/tool_sub.py -i {sample}", shell=True)


def dynamic_basename(outdir, prefix):
    # Honesty ceiling: the BASENAME itself is interpolated (a runtime-generated
    # script in a runtime directory), not merely the leading directory — there is
    # no statically knowable target file, so this must NOT mint a crossLang edge.
    subprocess.run(f"Rscript {outdir}/{prefix}.generated.R", shell=True)
