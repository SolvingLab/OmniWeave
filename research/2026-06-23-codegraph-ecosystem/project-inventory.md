# Project Inventory

Evidence levels:

- `source-clone`: source repository should be cloned and inspected locally.
- `source-sampled`: repository is very large; inspect architecture-critical source slices locally or via official source.
- `official-docs`: closed-source or product-scale system; use official documentation/blogs only.
- `paper`: research system; inspect paper and any released code if available.
- `community-signal`: social/forum signal only; never sufficient for technical claims.

## Primary Open-Source Code Targets

| ID | Project | Repository | Evidence | Why it matters |
|---|---|---|---|---|
| codegraph | CodeGraph | `colbymchenry/codegraph` | source-clone | OmniWeave's upstream baseline and closest structural MCP ancestor. |
| codebase-memory | codebase-memory-mcp | `DeusData/codebase-memory-mcp` | source-clone | Fast C/static-binary graph engine with broad language and semantic/search claims. |
| cgc | CodeGraphContext | `CodeGraphContext/CodeGraphContext` | source-clone | Python graph/MCP system with DB backend plurality and optional SCIP. |
| serena | Serena | `oraios/serena` | source-clone | LSP-backed symbol-level agent toolkit; strongest LSP/MCP peer. |
| aider | Aider repo-map | `Aider-AI/aider` | source-clone | Canonical repo-map/context-compression implementation. |
| codanna | Codanna | `bartolli/codanna` | source-clone | Rust local code intelligence MCP with semantic search plus relationships. |
| graphify | Graphify | `safishamsi/graphify` | source-clone | Popular skill/graph memory system spanning code/docs/multimodal. |
| understand-anything | Understand Anything | `Egonex-AI/Understand-Anything` | source-clone | Popular onboarding/interactive code knowledge graph. |
| claude-context | Claude Context | `zilliztech/claude-context` | source-clone | Vector/semantic code-search MCP; contrast to structural retrieval. |
| blarify | Blarify | `blarApp/blarify` | source-clone | Small graph-from-codebase project using external graph DB style. |
| code-review-graph | code-review-graph | `tirth8205/code-review-graph` | source-clone | Review-oriented local code intelligence graph. |
| code-graph-mcp | code-graph-mcp | `entrepeneur4lyf/code-graph-mcp` | source-clone | Smaller AST/graph MCP baseline. |
| code-graph-mcp-2 | sdsrss/code-graph-mcp | `sdsrss/code-graph-mcp` | source-clone | Newer lightweight AST knowledge graph MCP. |
| semantic-search-mcp | semantic-search-mcp | `adam-hanna/semantic-search-mcp` | source-clone | Minimal semantic-search-only MCP contrast. |

## Large Code-Intelligence / Static-Analysis Systems

| ID | Project | Repository | Evidence | Why it matters |
|---|---|---|---|---|
| scip | SCIP | `scip-code/scip` | source-clone | Language-agnostic code intelligence exchange format. |
| kythe | Kythe | `kythe/kythe` | source-sampled | Google-origin language-agnostic semantic graph standard. |
| glean | Glean | `facebookincubator/Glean` | source-sampled | Meta fact database and Angle query language. |
| codeql | CodeQL | `github/codeql` | source-sampled | Query-code-as-data system; security/semantic analysis reference. |
| joern | Joern | `joernio/joern` | source-sampled | Code Property Graph implementation and DSL. |
| semgrep | Semgrep | `semgrep/semgrep` | source-sampled | Pattern/static-analysis engine; broad language matching. |
| opengrep | Opengrep | `opengrep/opengrep` | source-sampled | Open Semgrep fork; static-analysis governance contrast. |

## Research Code / Papers

| ID | Project | Repository or URL | Evidence | Why it matters |
|---|---|---|---|---|
| repograph | RepoGraph | `ozyyshr/RepoGraph` | paper + source-clone | Repository-level graph augmentation for SWE-bench style tasks. |
| coderag-bench | CodeRAG-Bench | `code-rag-bench/code-rag-bench` | paper + source-clone | Benchmark for retrieval-augmented code generation. |
| codexgraph | CodexGraph | paper + `modelscope/modelscope-agent` app pointer | paper + source-sampled | Graph database interface for LLM agents over code repositories. |
| coderag | CodeRAG | ACL/EMNLP paper | paper | Multi-path retrieval/reranking for repository-level completion. |

## Product / Closed-Source / Official-Docs Targets

| ID | Project | Public source | Evidence | Why it matters |
|---|---|---|---|---|
| cursor | Cursor codebase indexing | official blog/docs | official-docs | Semantic indexing, Merkle-tree reuse, product-grade UX. |
| sourcegraph | Sourcegraph / SCIP usage | official docs/blog + SCIP | official-docs | Enterprise code navigation/search and cross-repo indexing. |
| github-copilot-agent | GitHub Copilot coding agent | official docs | official-docs | Cloud-agent workflow and repository research pattern. |
| claude-code | Claude Code | official docs / public npm repo metadata | official-docs | Agent baseline and MCP ecosystem host. |
| openai-codex | OpenAI Codex CLI | `openai/codex` | source-sampled | Local coding agent host and MCP integration context. |
| continue | Continue | `continuedev/continue` | source-sampled | Open-source IDE assistant with codebase retrieval/RAG. |

## Community Signals

| ID | Source | Evidence | Use |
|---|---|---|---|
| twitter-codegraph | X/Twitter search via `bird` | community-signal | Demand framing only: "stop agents from grepping" is a resonant market narrative. |
| reddit-mcp | Reddit search snippets | community-signal | Demand/pain signal only; not technical evidence without source inspection. |
