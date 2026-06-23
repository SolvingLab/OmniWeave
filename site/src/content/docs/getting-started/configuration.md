---
title: Configuration
description: OmniWeave is zero-config by default, with one optional project config for custom file extensions.
---

OmniWeave is **zero-config by default**. Language support is automatic from the file extension, and `.gitignore` remains the source of truth for what gets excluded.

The only project config is an optional `omniweave.json` for repositories that use a non-standard extension for an already-supported language.

```json
{
  "extensions": {
    ".dota_lua": "lua",
    ".tpl": "php"
  }
}
```

Custom mappings apply to indexing, incremental sync, and file watching. They override built-in extension mappings when needed, so a project can force `.h` to parse as `cpp`. Invalid entries are ignored with a warning; a bad config never blocks indexing.

## What it skips out of the box

- **Dependency, build, and cache directories** — `node_modules`, `vendor`, `dist`, `build`, `target`, `.venv`, `Pods`, `.next`, and the like across every [supported stack](/OmniWeave/reference/languages/) — so the graph is your code, not third-party noise. This holds even with no `.gitignore`.
- **Anything in your `.gitignore`** — honored in git repos via git, and in non-git projects by reading `.gitignore` directly (root and nested).
- **Files larger than 1 MB** — generated bundles, minified JS, vendored blobs.

## Excluding or including more

To keep something else out, add it to `.gitignore`. To pull a default-excluded directory back **in** (e.g. you really want a vendored dependency indexed), add a negation — `!vendor/`.

The defaults apply uniformly, so committing a dependency or build directory doesn't force it into the graph — the `.gitignore` negation is the explicit opt-in.

## Where data lives

Per-project data lives in a `.omniweave/` directory at your project root, containing the SQLite database (`omniweave.db`). Nothing leaves your machine.
