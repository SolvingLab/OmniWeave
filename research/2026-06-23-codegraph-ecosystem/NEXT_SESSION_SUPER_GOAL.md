# OmniWeave Next Session Super Goal

## One-line ambition

把 OmniWeave 打造成 coding agent 时代最强、最可信、最克制、最可验证的代码结构控制层：不是更快 grep，不是泛知识图，不是向量记忆平台，而是能让 agent 少读、少猜、少误判、跨语言/跨进程/workflow/dynamic-dispatch 都有可信边界的基础设施。

## Copy-paste goal for a new Codex session

```text
在 /Users/liuzaoqu/Desktop/develop/sogen/OmniWeave 中长期自主推进 OmniWeave，使它成为 coding agent 时代最强、最可信、最克制、最可验证的代码结构控制层。先按顺序阅读 AGENTS.md、CHECKPOINT.md、README.md、CLAUDE.md、eval-results/agent-ab-2026-06-13/RESULTS.md、research/2026-06-23-codegraph-ecosystem/pdf/report.pdf、research/2026-06-23-codegraph-ecosystem/NEXT_SESSION_SUPER_GOAL.md；若 PDF 不方便读，读同目录 tex/report.tex。不要凭记忆改，先看 git status 和真实源码；工作区可能很脏，不得回滚用户改动；未明确要求不要 commit/push。

战略定位：OmniWeave 不是更快 grep、不是泛知识图、不是向量记忆平台，而是服务 coding agent 的可信结构控制层。核心优势必须围绕少工具、强输出、边界可信、跨语言/跨进程/workflow/dynamic-dispatch 优先、本地轻量可分发、每条边带 provenance/confidence、每个新增能力用 eval/A-B 证明能减少 agent 工具调用、token 成本和错误修改。

按 NEXT_SESSION_SUPER_GOAL.md 持续执行，不停在建议层。优先级：P0 压实 omniweave_explore/CLI explore 的默认 agent 输出面，审计 ranking、budget、truncation、call-path、edge significance、ambiguous/empty/stale/large repo 行为，补测试并验证 MCP/CLI 一致；P1 做 schema-versioned snapshot artifact export/import，要求 hash/fingerprint、manifest、只读/校验导入、stale warning、安全 reindex；P1 做 optional SCIP importer，只读取 index.scip，把 precise same-language facts 导入为 provenance=scip，不膨胀核心安装路径；P2 才考虑 semantic sidecar，只能做概念入口和排序，绝不能制造 calls/imports/overrides/crossLang/workflow 等结构事实；P2 再考虑 graph-backed PR review vertical。

严禁：默认扩成 14+ MCP tools；把向量召回当结构事实；把 LLM docs、Neo4j/Kuzu/Falkor、多 UI、自由查询语言放进核心路径；静态伪造运行时事实；无 eval 加 edge kind；为了“宏大”牺牲安装、性能、可维护性和输出克制。

每轮先建立系统图和风险面，再最小步实现、验证、修复。必须遵守用户的工程交付强制规范：极简、奥卡姆剃刀、高性能、无魔法状态、无不必要抽象、可被顶级团队 review。每次改动后跑最小相关测试，必要时扩大到 npm run build、npx vitest run、npm run eval、benchmark/real-repo smoke。完成标准不是“能跑”，而是 OmniWeave 在选定赛道明显强于 codegraph、Codebase-Memory、Serena、Codanna/SCIP、semantic search、code-review-graph 等项目：默认工具面最好、跨边界图最诚实、agent 成本下降有证据、snapshot/stale/failure 行为可靠、文档边界清楚且不过度宣称。一直运行，持续 review -> repair -> validate，直到达到超级完美化。
```

## Must-read context, in order

1. `/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave/AGENTS.md`
2. `/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave/CHECKPOINT.md`
3. `/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave/README.md`
4. `/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave/CLAUDE.md`
5. `/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave/eval-results/agent-ab-2026-06-13/RESULTS.md`
6. `/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave/research/2026-06-23-codegraph-ecosystem/pdf/report.pdf`
7. `/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave/research/2026-06-23-codegraph-ecosystem/tex/report.tex`
8. This file.

Before changing code, inspect live repo state with `git status --short`, then read the exact files/symbols to be touched. The repo is likely dirty; never revert user changes.

## Product positioning

OmniWeave should own one thing better than everyone else:

> A trusted structural control layer for coding agents.

It should make a coding agent know where to look, what relation is real, what relation is inferred, what is unknown, and when not to guess. Its strategic advantage is the combination of:

- local, lightweight, distributable core: Node 22.5+, WASM tree-sitter, SQLite/FTS;
- high-confidence structural edges with provenance/confidence;
- cross-boundary relations that LSP/grep/vector search usually miss: cross-language subprocess, workflow DAG, external tools, R S4/dynamic dispatch declarations;
- small default MCP surface, especially `explore` as the primary agent tool;
- A/B evidence that new capabilities reduce agent tool calls, token cost, and wrong edits.

## Strategic north star

Build toward a tool that can be dropped into an unfamiliar large repo and reliably answer:

- What code is relevant to this task?
- What calls or depends on this symbol?
- What cross-language/process/workflow boundary is involved?
- What can be changed safely?
- What should the agent read next, and what should it avoid guessing?
- What evidence supports this answer?

The output must be immediately useful to agents: concise, ranked, source-backed, line-addressable, and honest about uncertainty.

## What to borrow from the research

- From codegraph: keep `explore` primary, reduce tool-choice ambiguity, continue output-budget discipline, preserve worker recycling/watch freshness discipline.
- From Codebase-Memory: add schema-versioned snapshot/artifact export/import, read-only safety gates for any future query surface, installer/control-plane polish.
- From Codanna/SCIP: introduce stable symbol identity and optional `index.scip` importer for precise same-language facts, always marked with `provenance=scip`.
- From Serena: treat LSP as a complementary precision source and editing/checking partner, not as the graph core.
- From semantic-search projects: semantic sidecar may help concept entry, but it must never manufacture structural facts.
- From code-review-graph: consider a review vertical that turns graph evidence into PR-risk context, but keep it layered above the core.

## What not to borrow

- Do not turn OmniWeave into a general knowledge graph, dashboard, or visualization-first product.
- Do not expand default MCP tools just because competitors have 14+ tools.
- Do not put vector search, LLM documentation generation, Neo4j/Kuzu/Falkor, or free-form query language into the core path.
- Do not claim dynamic/runtime facts statically. If uncertain, output no edge or a clearly marked low-confidence/provenance-bound inference.
- Do not add new edge kinds unless they materially reduce agent cost and survive eval.

## Implementation priorities

### P0: Output and tool-surface hardening

Make `omniweave_explore` / CLI `explore` feel like the definitive agent read primitive.

Required work:
- audit ranking, budgets, truncation, symbol grouping, call-path formatting, edge significance, recovery behavior, and failure/empty states;
- ensure output is compact, source-backed, line-addressable, and not JSON-noisy;
- add tests for large files, ambiguous symbols, empty index, stale index, overloaded names, cross-language paths, and irrelevant-result suppression;
- verify MCP and CLI surfaces stay aligned.

Acceptance:
- a fresh agent can answer architecture/code-change questions with fewer reads than grep-only baseline;
- output never hides uncertainty or fabricates relations;
- no new unnecessary public tools.

### P1: Snapshot/artifact sharing

Add `omniweave snapshot export/import` or equivalent, with strict safety.

Required work:
- manifest with schema version, OmniWeave version, source-root hash/fingerprint, file count, edge/node counts, language list, creation time;
- compressed bundle or directory snapshot;
- import as read-only or validated local cache;
- mismatch/stale warning and safe reindex path;
- corruption tests, version mismatch tests, path-relocation tests.

Acceptance:
- team/CI cold start improves without replacing local truth;
- no silent stale graph.

### P1: Optional SCIP importer

Add SCIP as an optional precision source, not the core.

Required work:
- read `index.scip`;
- map definitions/references/inheritance into OmniWeave nodes/edges where safe;
- preserve original SCIP symbol string and provenance;
- handle duplicates/conflicts with tree-sitter facts;
- add small fixtures and a real-repo smoke test if feasible.

Acceptance:
- improves same-language precision without bloating normal install path.

### P2: Semantic sidecar

Add only if it stays a sidecar.

Rules:
- semantic results may rank entry points or suggest files;
- semantic results must not create `calls`, `imports`, `overrides`, `crossLang`, or workflow edges;
- index/update must be cancellable and isolated from core graph health.

### P2: Review vertical

Build a graph-backed PR/change-risk helper only after P0/P1 are solid.

It should summarize touched symbols, impacted callers, cross-boundary risks, missing tests, and risky unknowns. It should not become a generic review bot.

## Evaluation gates

Every meaningful change must pass:

- `npm run build`
- `npx vitest run` or focused test plus justified broader run
- relevant `npm run eval` fixtures after indexing
- benchmark/capability matrix when retrieval/ranking behavior changes
- at least one real-repo smoke test for cross-boundary behavior when relevant

Add new evals before or alongside new features. A feature is not done until it has a red-to-green fixture and does not regress existing capability numbers.

## Engineering taste

Follow the user's strict taste:

- fewer concepts, fewer tools, fewer visible surfaces;
- deep correctness below a clean interface;
- fast paths first, no avoidable reparse/reindex/re-render;
- no magic, no hidden state, no unverifiable claims;
- if a change would embarrass a top-tier systems/code-intelligence review, keep working.

## Done when

The long-running goal should continue until OmniWeave is clearly stronger than nearby tools in its chosen lane:

- best default agent tool surface among codegraph/codebase-memory/code-intelligence projects;
- strongest honest cross-boundary graph for coding agents;
- reproducible eval evidence that OmniWeave reduces agent cost and wrong turns;
- install, snapshot, stale-state, and failure behavior are boringly reliable;
- documentation states sharp boundaries and does not overclaim.
