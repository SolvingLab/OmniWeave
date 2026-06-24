# 工程交付强制规范 §0–§10 超严格审计台账（2026-06-24）

**方法**：把 CLAUDE.md / AGENTS.md 末尾《工程交付强制规范》§0–§10 的每条 invariant 当断言，用 Workflow fan-out 6 桶（每桶一 agent，schema 化 `{断言→PASS/FAIL→真实值→durable 锚点(名字非行号)→证据命令}`），再跟一道对抗式 skeptic 重核（默认证伪每条 PASS、挖审计漏掉的 FAIL）。12 agents / 720 工具调用 / 714.6k tokens，全程读真源码 + 跑真命令。

**结果**：56 断言 — **PASS=48 / PARTIAL=5 / FAIL=3**。3 个 FAIL + 全部可动手的 PARTIAL/skeptic-P2 已修或证伪闭环（下表）。

| 桶 | 断言 | PASS | PARTIAL | FAIL |
|---|---|---|---|---|
| §0–§1 铁律/工具/决策 | 12 | 9 | 2 | 1 |
| §2 输出面 | 9 | 8 | 1 | 0 |
| §3 预算 | 8 | 8 | 0 | 0 |
| §4 图信任 | 8 | 7 | 0 | 1 |
| §5 性能资源 | 12 | 12 | 0 | 0 |
| §6–§7 分发/统一 | 7 | 4 | 2 | 1 |

## 已修（红→绿，含回归）

| ID | 类别 | 问题 | 修复 | 锚点 |
|---|---|---|---|---|
| A | §0 诚实纪律 | steering（每会话发给 agent 的 `SERVER_INSTRUCTIONS`）含 "More accurate context" 准确性优越声明 | 改写为「The relevant structural context — source plus callers and dependents — in far fewer tokens and round-trips」，只留努力/相关性价值 | `SERVER_INSTRUCTIONS` in `src/mcp/server-instructions.ts` |
| B | §4 spec 文档 | spec 写 "EdgeKind 15 值" 但列表/代码均 16（含 `exports`） | CLAUDE.md + AGENTS.md §4 "15 值"→"16 值"（两文件同步） | `EdgeKind` in `src/types.ts`（真实 16）|
| C | §1 奥卡姆/死代码 | `ExploreOutputBudget.excludeLowValueFiles` 接口字段 + 5 处赋值，**0 读取**（真实过滤在 handleExplore 无条件全 tier 跑，不读该字段）；docstring 还与实际行为矛盾 | 删字段 + docstring + 5 赋值（纯死代码移除，0 行为变化） | `ExploreOutputBudget` / `getExploreOutputBudget` in `src/mcp/tools.ts` |
| D | §7 注释诚实 | `getExploreOutputBudget` 注释称档位 "mirror getExploreBudget…same tier"，实际两者断点不一致（输出预算多 <150 微档、顶 15000；调用预算无微档、顶 25000）| 改注释为「两个独立 knob，断点不同」 | `getExploreOutputBudget` in `src/mcp/tools.ts` |
| E | §7 数值契约 | `resolveCacheLimit` 用 `Number.parseInt`，`'2abc'`→2（违反 §7「`Number()` 非 parseInt，`'2abc'`→default」）| 改 `Number(raw.trim())` + `Number.isInteger` 校验 | `resolveCacheLimit` in `src/resolution/index.ts` |
| F | §2 输出面诚实 | MCP 空 explore 第 4 条续查是纯散文 "refresh the index"（无工具名，违反 §2「MCP 给工具名」；MCP 无 sync 工具）| 改为「give the file watcher a moment…then re-run `omniweave_explore`」——工具可执行且诚实（watcher ~1s lag 已在 steering 声明） | `buildNoExploreResultsMessage` in `src/mcp/tools.ts` |

回归：`__tests__/context-ranking.test.ts` 旧断言锁死弱散文 "refresh the index" → 改为断言新工具化续查（`file watcher` + `omniweave_explore` + `not.toContain('refresh the index')`）。新增 `__tests__/dashboard-render.test.ts`(17) + `__tests__/quiet-warnings.test.ts`(7)；`__tests__/glyphs.test.ts` 等额约束更新。

## 已证伪 / 无需动（skeptic 推翻审计，或本就达标）

| ID | 审计裁定 | 真相 | 证据命令 |
|---|---|---|---|
| S7-version-single-truth | 审计判 FAIL（v1.0.1 tag 领先 package.json 1.0.0）| **PASS**：`v1.0.1` 是 **upstream tag**，非本仓 main 祖先；本仓 package.json=CHANGELOG=build-id 全 1.0.0 一致 | `git merge-base --is-ancestor v1.0.1 main` → NOT ancestor |
| S6-fingerprint-test | PARTIAL（断言分散）| 达标：`build-fingerprint.test.ts`（rendezvous 拒绝）+ `mcp-daemon.test.ts`（真进程 in-process fallback）双覆盖，均绿 | `npx vitest run __tests__/build-fingerprint.test.ts` |
| S0-all-synthesizers | PARTIAL（rn-cross-platform 名字匹配 over-approx）| 可接受：启发式边，带 `provenance='heuristic'` + JS-caller gate + RN_INFRA 排除集；符合「确定的不标、猜的才标 confidence」信任模型 | `rg "synthesizedBy\|provenance" src/resolution/callback-synthesizer.ts` |

## 诚实记录的已知局限（不修，带理由）

- **in-process WASM 解析无 PARSE_TIMEOUT_MS**（`src/extraction/index.ts` worker 缺失退 in-process 路径）：同步 tree-sitter 解析无法被中断，超时只能靠 worker 终止实现。生产默认走 worker 池（有超时）；in-process 仅测试/无 worker 兜底路径。属同步解析固有限制，非可修缺陷。
- **`decorates` 边不进 RANK_EDGES/significantEdges/recoveryKinds/callers 表**：`decorates` 由 `tree-sitter.ts` 发出、`name-matcher.ts` 解析、入库可查，但不在 explore 关系区作「显著边」呈现——这是有意选择（装饰器常为噪声）。无 A/B 证据表明应上浮（PARK 纪律：无新反证不加形态税）。

## 结论

§0–§10 每条 invariant 均有 PASS 证据或修复闭环；3 FAIL（2 spec 文档计数 + 1 被 skeptic 证伪）、可动手 PARTIAL/P2 全修。**错边比漏边、默认 5 工具（小仓 3）、25k 硬顶在所有 wrapper 后、5 档 per-file 单调、S4 确定性边不带 provenance / crossLang 启发式带 confidence 的信任分层、FileLock 活 PID 拒抢、daemon 指纹 skew、CLI-MCP 同查询不矛盾、数值 clamp** —— 全部实跑核验 PASS。
