# Crucible State: Codegraph Ecosystem Deep Research

## Topic

Deeply investigate the code-intelligence / code-graph / codebase-memory ecosystem mentioned in the prior discussion, inspect available source code, produce a LaTeX report compiled to PDF, and derive cautious, evidence-backed lessons for OmniWeave.

## Locked Decisions

- Scope is intentionally broad: include traditional code-intelligence infrastructure, static-analysis graph systems, LSP/IDE agent tooling, repo-map/context compression, MCP code-graph/memory projects, semantic code-search projects, and relevant repo-level graph research.
- Output must be a new self-contained research folder under the OmniWeave repo, with source snapshots or metadata, notes, LaTeX source, and compiled PDF.
- Closed-source products may be analyzed only via official docs/public sources; no invented code-level claims.
- Open-source projects should be inspected at source level where feasible; large projects may be sampled through architecture-critical files rather than line-by-line exhaustion.
- The report must distinguish evidence strength: cloned source, official docs, paper, GitHub metadata, search result, or social/community signal.
- The strategic answer for OmniWeave must be cautious: identify transferable patterns, non-transferable traps, and experiments/gates before adopting anything.

## Current Highest Path

Use a two-layer investigation:

1. Breadth map: enumerate all relevant projects and classify by role, openness, source availability, claimed capabilities, and relationship to OmniWeave.
2. Depth slices: for each major project, inspect its actual implementation path for parsing/indexing/storage/query/MCP/output/evaluation/distribution, then compare against OmniWeave's measured edge.

## Candidate Projects

- Core standards / infra: SCIP, Kythe, Glean, Sourcegraph.
- Static/security analysis: CodeQL, Joern, Semgrep, Opengrep.
- Agent IDE/LSP/context tools: Serena, Aider repo-map, Continue, Cursor docs, Claude/Codex/GitHub Copilot docs where relevant.
- MCP/code graph/memory: colbymchenry/codegraph, DeusData/codebase-memory-mcp, CodeGraphContext, Codanna, Blarify, code-review-graph, code-graph-mcp variants.
- Knowledge graph / onboarding / multimodal: Graphify, Understand Anything.
- Semantic code search: Claude Context, semantic-search-mcp, grepai if useful.
- Research: RepoGraph, CodeRAG, CodexGraph, CodeRAG-Bench, GraphRAG surveys where directly relevant.

## Pending

- Build a machine-readable project inventory.
- Clone or snapshot open-source repositories without disturbing OmniWeave's worktree.
- Inspect code paths and record per-project notes.
- Draft LaTeX report and compile PDF.
- Validate PDF exists and includes citations/evidence.

## Capture Notes

- `repos/codanna` was interrupted during a filtered checkout and remains a partial clone with many deleted worktree entries.
- `repos/codanna-clean` is the clean no-filter shallow clone to use for Codanna source inspection.
- Large `source-sampled` systems are intentionally not fully cloned by default; inspect targeted source files/docs instead.
