"""A sibling sub-tool script invoked by dispatch.py through a 'this-directory'
interpolation prefix. Its mere existence in the repo is what makes the
interpolated-prefix crossLang edge statically resolvable (the basename matches a
real indexed file next to the caller)."""


def main():
    return "sub-tool ran"
