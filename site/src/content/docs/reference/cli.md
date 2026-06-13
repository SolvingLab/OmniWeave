---
title: CLI
description: Every OmniWeave command and the flags it accepts.
---

```bash
omniweave                         # Run interactive installer
omniweave install                 # Run installer (explicit)
omniweave uninstall               # Remove OmniWeave from your agents (inverse of install)
omniweave init [path]             # Initialize in a project (--index to also index)
omniweave uninit [path]           # Remove OmniWeave from a project (--force to skip prompt)
omniweave index [path]            # Full index (--force to re-index, --quiet for less output)
omniweave sync [path]             # Incremental update
omniweave status [path]           # Show statistics
omniweave query <search>          # Search symbols (--kind, --limit, --json)
omniweave files [path]            # Show file structure (--format, --filter, --max-depth, --json)
omniweave context <task>          # Build context for AI (--format, --max-nodes)
omniweave callers <symbol>        # Find what calls a function/method (--limit, --json)
omniweave callees <symbol>        # Find what a function/method calls (--limit, --json)
omniweave impact <symbol>         # Analyze what code is affected by changing a symbol (--depth, --json)
omniweave affected [files...]     # Find test files affected by changes
omniweave serve --mcp             # Start MCP server
```

## Query commands

`query`, `callers`, `callees`, and `impact` all accept `--json` for machine-readable output.

```bash
omniweave query UserService --kind class --limit 10
omniweave callers handleRequest --json
omniweave impact AuthMiddleware --depth 3
```

## affected

Traces import dependencies transitively to find which test files are affected by changed source files. See [Affected Tests in CI](/OmniWeave/guides/affected-tests/) for options and a CI example.
