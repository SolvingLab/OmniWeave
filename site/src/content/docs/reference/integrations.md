---
title: Integrations
description: Supported agents, and manual MCP setup.
---

The interactive installer auto-detects and configures each supported agent — wiring up the MCP server and writing its instructions file.

## Supported agents

- **Claude Code**
- **Cursor**
- **Codex CLI**
- **opencode**
- **Hermes Agent**
- **Gemini CLI**
- **Antigravity IDE**
- **Kiro**

Run `npx @solvinglab/omniweave` and pick your agent(s); see [Installation](/OmniWeave/getting-started/installation/) for the non-interactive flags.

## Manual setup

If you'd rather wire it up yourself, install globally:

```bash
npm install -g @solvinglab/omniweave
```

Add the MCP server to `~/.claude.json`:

```json
{
  "mcpServers": {
    "omniweave": {
      "type": "stdio",
      "command": "omniweave",
      "args": ["serve", "--mcp"]
    }
  }
}
```

Optionally auto-allow the read-only tools in `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__omniweave__omniweave_search",
      "mcp__omniweave__omniweave_callers",
      "mcp__omniweave__omniweave_callees",
      "mcp__omniweave__omniweave_impact",
      "mcp__omniweave__omniweave_node",
      "mcp__omniweave__omniweave_status",
      "mcp__omniweave__omniweave_files"
    ]
  }
}
```

:::tip
Cursor launches MCP subprocesses with the wrong working directory. The installer handles this for you by injecting a `--path` argument; if you wire Cursor up by hand, pass the project path explicitly.
:::
