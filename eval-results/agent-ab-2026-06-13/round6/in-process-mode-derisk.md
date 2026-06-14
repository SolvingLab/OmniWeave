# 轨道3 —— 降固定层：进程内/嵌入式 mode de-risk 到设计就绪（不硬建）

> round5 终建议 v2 钉死的「换层」前沿：prompt-routing 已到顶（变量形态税削平），**剩余的固定
> MCP 附着开销只能靠换形态降**。本文按 §0.17（不在马拉松尾巴赶脆弱子系统）把进程内 mode
> **de-risk 到设计就绪 + 阻塞测绘**，并给出「现在不建」的诚实判据。配套：固定层静态分解 +
> ToolSearch 门控隔离 A/B（见 `RESULTS-round6.md` 轨道3 节）。

## 1. 固定层到底是什么（静态实测分解，2026-06-14）

「单点题 with > without 的那 ~34k」不是单一来源。逐项实测拆开（`dist/` 实测字节 ÷ 4）：

| 层 | 来源 | 谁控制 | 实测 token | 可降性 |
|---|---|---|---|---|
| OmniWeave server-instructions | `src/mcp/server-instructions.ts`（每 session 进系统提示） | **OmniWeave** | **~2,397** | 可裁（删冗余段） |
| 默认 5 工具 schema | `tools.ts` search/callers/impact/node/explore 的 description+inputSchema | **OmniWeave** | **~1,529**（其中 `node` 单个 634） | 可裁（`node` 描述最肥） |
| 全 8 工具 schema | 含 callees/files/status | OmniWeave | ~2,049 | — |
| ToolSearch 门控机制 | deferred 工具名单 + ToolSearch 工具 schema + **门控往返**（agent 必须先 ToolSearch 才能调 omniweave 工具） | **客户端（Claude Code）** | 余下大头（往返 + 注入） | OmniWeave **不可控**；用户可配 `ENABLE_TOOL_SEARCH` 关闭 |

**关键拆分**：固定层 = **OmniWeave 自身可降文本（~3.9k）** + **客户端 ToolSearch 门控（余下，OmniWeave 不可控）**。
- round4/round5 把整块记为「~34k、prompt 不可降」是对的（prompt 路由确实降不了 schema/门控）。
- 但**「prompt 不可降」≠「不可降」**：OmniWeave 自身那 3.9k 可以靠**裁 schema/instructions**降（轨道3 候选①③，已做隔离 A/B），客户端门控那部分可以靠**用户配置 `ENABLE_TOOL_SEARCH=auto:100`**降一个往返（候选②，已做隔离 A/B）。
- **进程内 mode 是把「整块固定层」连根拔掉的唯一路径**（不再是 MCP server → 没有 server-instructions 注入、没有工具 schema、没有 ToolSearch 门控）——但它是**换形态**，不是裁字节。

## 2. 目标形态（§1.5 锁死的 Aider 甜点区）

§1.5 实证结论：顶级 agent（Claude Code/opencode）属「不建索引派」，**不接 codegraph 式 daemon 图**；唯一被这派接纳的结构图是 **Aider 式**——
> 进程内、零配置、即时、按 mtime 缓存每次重建（永不陈旧）、token 预算感知、无向量库、无 daemon、无云。

进程内 mode 的设计北极星 = **把 OmniWeave 的图价值（结构边：跨语言/跨进程/动态分派）以 Aider repo-map 的形态交付，绕开 MCP 的固定附着开销**。

## 3. 三条候选集成路径（按「降固定层力度 × 工程风险」排）

| 路径 | 怎么降固定层 | 工程量 | 致命风险 | 判定 |
|---|---|---|---|---|
| **A. 库/嵌入式 API** | OmniWeave 作为 npm 库被宿主（Aider 式工具 / 自建薄客户端）`import`，宿主在 prompt 组装期注入 repo-map，**完全不走 MCP** → 固定层归零 | 中（API 已有雏形：`OmniWeave.open()` + traversal 已是库） | 没有宿主会集成（§1.5 诚实怀疑：48k star ≠ 承重）；等于自建一个 Aider | **设计就绪，不建**（无第二方宿主、无 testbed） |
| **B. CLI-as-context（hook 注入）** | 用 Claude Code 的 **SessionStart/UserPromptSubmit hook** 跑 `omniweave query` 把结构摘要塞进上下文，**不注册 MCP 工具** → 无 schema、无门控 | **小**（CLI `query/explore` 已存在；hook 是配置） | 注入的是「静态摘要」不是「按需查询」——agent 无法追问；可能注入了用不上的 token（变回 explore-过度） | **可原型，最低风险**（见 §5 最小原型） |
| **C. 门控旁路（保持 MCP，去 ToolSearch 门控）** | 仍是 MCP server，但建议用户 `ENABLE_TOOL_SEARCH=auto:100` / standard 模式，eager-load 工具 → 省 1 门控往返 | 零（用户配置） | 不降 schema/instructions 那 3.9k，只省往返；且是**用户侧配置**，OmniWeave 文档能建议但不能强制 | **已隔离 A/B 量化**（轨道3 节），作为「立即可用的缓解」 |

## 4. 阻塞测绘（design-ready 的硬阻塞，逐条）

1. **没有第二方宿主（路径 A 的死穴）**：进程内库 mode 只有在「别的 agent/工具愿意 import OmniWeave」时才省固定层。§1.5 已证这派（Claude Code）哲学上不接结构图 daemon，也不太会接库。**没有 testbed = 无法 eval = 不能证值**。这是 §0.17 说的「无第二个证据驱动 testbed」的典型——**硬建 = 赌一个不存在的集成方**。
2. **「注入摘要」vs「按需查询」的张力（路径 B）**：MCP 工具的价值正是**按需**（agent 问什么给什么，token 跟着问题走）。hook 注入是**预先**塞——要么塞多了（explore-过度的固定版，比 MCP 还浪费），要么塞少了（agent 还得追问，又退回 grep）。round5 轨道B 已证 agent 的 find-then-read 习惯不可 prompt 控——**预注入解决不了这个习惯，可能放大它**。
3. **保鲜语义换形态后要重写**：当前 MCP 模式靠 file-watcher + staleness banner 保鲜（§1.5 说这是「退路不是卖点」）。Aider 式「按 mtime 每次重建」在进程内是常数开销，但在「CLI 每次冷启」下要付索引读取/校验成本——**冷启性能未测**（MCP 模式是常驻热缓存，亚毫秒；CLI 冷启含 grammar 加载 + DB open，round4 实测 explore 8.58s 含启动）。
4. **与 LSP 撞车风险不变（§1.5②）**：换成进程内也不能去做 callers/callees/impl（LSP 主场）；进程内 mode 仍只能卖跨语言/跨进程/动态分派。换形态**不扩能力边界**，只降固定层——所以 ROI 上限 = 那 ~34k，不是新增赢面。

## 5. 最小可证原型（若未来要建，从这里起，不要从路径 A）

**路径 B 的最小原型**（风险最低、复用最多、可 eval）：
1. 复用现有 `omniweave query <nl>` / `omniweave explore`（CLI 已存在，输出已 token 预算感知）。
2. 写一个 `SessionStart` hook：对已索引仓，跑 `omniweave status` + 一次 `explore`「项目结构」摘要，注入 ≤2k token 的「结构地图」。
3. **eval 判据（红→绿）**：同一批单点/反向题，arm1 = MCP 模式（当前），arm2 = hook 注入模式（无 MCP 工具，只有注入摘要 + Bash 调 `omniweave` CLI）。量：
   - 固定层是否真降（arm2 首轮 input token 应少 ~34k）；
   - 正确性是否保持（arm2 能否靠注入摘要 + CLI 追问答对）；
   - **是否引入新形态税**（注入摘要塞了用不上的 token？agent 退回 grep？）。
4. **GO 判据**：arm2 在「固定层降 ≥20k 且正确性零损失且无新形态税」三条同时满足才 GO。**任一不满足 = 路径 B 也 NO-GO**，固定层认定为「MCP 形态的不可降成本」。

## 5.5 round6 实测把 ROI 上限从 ~34k 砍到 ~682 tok（决定性）

§1 的静态分解 + round6 隔离 A/B（`RESULTS-round6.md` 轨道3.1）实测推翻了「固定层 ~34k」的归因：
- **关 ToolSearch 门控不省反贵**：eager 全载 schema → first-turn 30.5k→46.5k（**+16k**）。门控是 token 最优。
- **OmniWeave 边际固定成本实测 = +682 tok**（同题同模型两臂 warm first-turn：without 30,586 vs with 31,268）。
  那 ~30k 是 **base Claude Code harness**（内置工具 deferral + ToolSearch 机制），**两臂都有、非 OmniWeave 的**。
- **所以进程内 mode 的真实 ROI 上限 = ~682 tok first-turn / ~2.7k session**，不是 round5 设想的 ~34k。

→ 一个「**赌不存在的第二方宿主 + 大工程**」去省 **~682 tok** 的子系统，ROI 彻底不成立。**这比 §6 原判据更硬**：
不仅「无 testbed」，而且「即便建成、省的也只有 ~682 tok」。

## 6. de-risk 终判（本轮，诚实）

- **进程内 mode = 设计就绪，但本轮不建**，判据三条：
  1. **路径 A（库）无 testbed**：没有第二方宿主愿意 import，无法 eval，硬建是赌不存在的集成方（§0.17 红线）。
  2. **路径 B（hook 注入）ROI 上限 = ~34k 且自带新风险**（预注入可能放大 find-then-read，变回 explore-过度）——值得未来用 §5 最小原型试，但**不在马拉松尾巴建脆弱子系统**。
  3. **路径 C（门控旁路）= 立即可用、零工程**，已隔离 A/B 量化（轨道3 节）——这是「现在就能给用户的固定层缓解」，把它写进 README/文档即可，不需要建任何东西。
- **可立即落地的固定层下降（不换形态）**：候选①③（裁 server-instructions / `node` schema）是 OmniWeave 自身那 3.9k 的可降部分——见 `RESULTS-round6.md` 轨道3 的隔离 A/B 结论决定是否落地（**前提：不破差异化、零正确性损失**）。
- **最终形态判断**：固定层的「整块拔除」需要换形态（进程内），而换形态**没有 eval testbed**——所以**固定层是 MCP 形态的诚实成本**，能做的是①把 OmniWeave 自身 3.9k 中可裁的裁掉、②文档建议用户开 `ENABLE_TOOL_SEARCH` 旁路门控。**这与 round5「降固定层需换形态」一致，但本轮把「换形态」从『下一步投资』降级为『无 testbed、NO-GO until 有宿主』**。
