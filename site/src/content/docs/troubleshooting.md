---
title: Troubleshooting
description: Fixes for the most common OmniWeave issues.
---

## "OmniWeave not initialized"

Run `omniweave init` in your project directory first.

## Indexing is slow

Check that `node_modules` and other large directories are excluded (they are, if gitignored). Use `--quiet` to reduce output overhead.

## MCP hits `database is locked`

Current builds shouldn't: OmniWeave bundles its own Node runtime and uses Node's built-in `node:sqlite` in WAL mode, where concurrent reads never block on a writer. If you still see it:

- **You're on an old (pre-0.9) install.** Reinstall to get the bundled runtime — `curl -fsSL https://raw.githubusercontent.com/SolvingLab/OmniWeave/main/install.sh | sh` (macOS/Linux), `irm https://raw.githubusercontent.com/SolvingLab/OmniWeave/main/install.ps1 | iex` (Windows), or `npm i -g @solvinglab/omniweave@latest`.
- **`omniweave status` shows `Journal:` other than `wal`** — WAL couldn't be enabled on this filesystem (common on network shares and WSL2 `/mnt`), so reads can block on writes. Move the project (with its `.omniweave/` folder) onto a local disk.

## MCP server not connecting

Ensure the project is initialized/indexed, verify the path in your MCP config, and check that `omniweave serve --mcp` works from the command line.

## Missing symbols

The MCP server auto-syncs on save (wait a couple of seconds). Run `omniweave sync` manually if needed. Check that the file's language is [supported](/OmniWeave/reference/languages/) and isn't excluded by `.gitignore`.
