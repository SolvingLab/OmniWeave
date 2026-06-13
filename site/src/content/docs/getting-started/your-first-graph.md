---
title: Your First Graph
description: Build an index and run your first queries against it.
---

Once OmniWeave is installed, building and exploring a graph takes three commands.

## Index a project

```bash
cd your-project
omniweave init -i      # initialize + index in one step
```

`init` creates the `.omniweave/` directory; `-i` (or `--index`) immediately builds the full index. For an existing project you can re-index any time:

```bash
omniweave index          # full index
omniweave sync           # incremental update of changed files
```

## Check it worked

```bash
omniweave status
```

This reports the node/edge/file counts, the active SQLite backend, and the journal mode — a quick health check that the index is ready.

## Run a query

```bash
omniweave query UserService          # find symbols by name
omniweave callers handleRequest      # what calls a function
omniweave callees handleRequest      # what a function calls
omniweave impact AuthMiddleware      # what a change would affect
omniweave context "fix the login flow"   # build task-focused context
```

Each accepts `--json` for machine-readable output. See the full [CLI reference](/OmniWeave/reference/cli/).

## Hand it to your agent

With a `.omniweave/` directory present and an agent configured (see [Installation](/OmniWeave/getting-started/installation/)), your agent uses the [MCP tools](/OmniWeave/reference/mcp-server/) automatically — no extra step.
