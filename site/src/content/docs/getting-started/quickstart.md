---
title: Get Started
description: Get up and running with OmniWeave in seconds.
---

Get up and running with OmniWeave in seconds.

## No Node.js required — one command grabs the right build for your OS

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/SolvingLab/OmniWeave/main/install.sh | sh

# Windows (PowerShell)
irm https://raw.githubusercontent.com/SolvingLab/OmniWeave/main/install.ps1 | iex
```

## Already have Node? Use npm instead (works on any version)

```bash
npx @solvinglab/omniweave        # zero-install, or:
npm i -g @solvinglab/omniweave
```

OmniWeave bundles its own runtime — nothing to compile, no native build, works the same everywhere. The interactive installer auto-configures your agent(s) — Claude Code, Cursor, Codex CLI, opencode, Hermes Agent, Gemini CLI, Antigravity IDE, Kiro.

## Initialize Projects

```bash
cd your-project
omniweave init -i
```

That's it — your agent will use OmniWeave tools automatically when a `.omniweave/` directory exists.

Next: build [Your First Graph](/OmniWeave/getting-started/your-first-graph/), or see the full [Installation](/OmniWeave/getting-started/installation/) options.
