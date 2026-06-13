---
title: API
description: Use OmniWeave as a TypeScript library.
---

OmniWeave ships a TypeScript API. The public surface is the `OmniWeave` class.

```typescript
import OmniWeave from '@solvinglab/omniweave';

const cg = await OmniWeave.init('/path/to/project');
// Or open an existing index:
// const cg = await OmniWeave.open('/path/to/project');

await cg.indexAll({
  onProgress: (p) => console.log(`${p.phase}: ${p.current}/${p.total}`),
});

const results = cg.searchNodes('UserService');
const callers = cg.getCallers(results[0].node.id);
const context = await cg.buildContext('fix login bug', {
  maxNodes: 20,
  includeCode: true,
  format: 'markdown',
});
const impact = cg.getImpactRadius(results[0].node.id, 2);

cg.watch();   // auto-sync on file changes
cg.unwatch(); // stop watching
cg.close();
```

## Key methods

| Method | Purpose |
|---|---|
| `OmniWeave.init(path)` / `OmniWeave.open(path)` | Create or open a project index |
| `indexAll(opts)` | Full index, with progress callback |
| `sync()` | Incremental update |
| `searchNodes(query)` | Full-text symbol search |
| `getCallers(id)` / `getCallees(id)` | Walk the call graph |
| `getImpactRadius(id, depth)` | Transitive impact of a change |
| `buildContext(task, opts)` | Markdown / JSON context for AI |
| `watch()` / `unwatch()` | Start / stop the file watcher |
| `close()` | Close the database connection |
