---
title: MCP Server
description: The tools OmniWeave exposes to AI agents over MCP.
---

OmniWeave runs as a [Model Context Protocol](https://modelcontextprotocol.io/) server. Start it with:

```bash
omniweave serve --mcp
```

Agents configured by the installer launch this automatically. When a `.omniweave/` index exists, the agent uses the tools below.

## Tools

| Tool | Purpose |
|---|---|
| `omniweave_search` | Find symbols by name across the codebase |
| `omniweave_callers` | Find what calls a function |
| `omniweave_callees` | Find what a function calls |
| `omniweave_impact` | Analyze what code is affected by changing a symbol |
| `omniweave_node` | Get details about a specific symbol (optionally with source code) |
| `omniweave_explore` | Return source for several related symbols grouped by file, plus a relationship map, in one call |
| `omniweave_files` | Get the indexed file structure (faster than filesystem scanning) |
| `omniweave_status` | Check index health and statistics |

## How agents should use it

OmniWeave *is* the pre-built search index. For "how does X work?", architecture, trace, or where-is-X questions, an agent should answer in a handful of OmniWeave calls and stop — typically with **zero file reads** — rather than re-deriving the answer with `grep` + `Read`. A direct OmniWeave answer is a handful of calls; a grep/read exploration is dozens.

The installer writes this guidance into each agent's instructions file automatically.
