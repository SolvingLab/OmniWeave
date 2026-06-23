# OmniWeave Agent A/B — Round 7「输出诚实化的可复现证据」（2026-06-23）

> 本轮补的是 [SESSION-REVIEW §4.1](../../research/2026-06-23-codegraph-ecosystem/SESSION-REVIEW-AND-NEXT-PLAN.md) 点名的最大窟窿：
> 上一跑（ec6d0eb..b246dae，71 commit）几乎全在 **P0 输出诚实化**，却**零新 A/B 数字**。
> 这轮把那 71 commit 变成**可复现的、隔离的因果数字**：它们到底让 agent 在哪类任务上少读 / 少绕 / 不被带偏。
>
> 方法学、原始产物见本目录 `deterministic/`（确定性输出 diff）与 `raw/`（agent 运行 jsonl）。
> 诚实纪律对齐 round1–6：**平手就记平手；快照抑制对 grep 不是护城河——如实写。**

## TL;DR

这一跑的 71 commit 里，**输出诚实化的一块（空结果恢复 + 竞品快照抑制 + node file-hint 取源）**被两层证据隔离量化：

- **它真实存在、且方向是「修危害」**：硬化前（`fc91305`），对**不存在的符号**查询会倒给 agent **24,273 字符**、引用 **5 个 gitignored 竞品快照路径**（serena/scip/cgc…）；硬化后只回 **558 字符**干净恢复指引。**同一索引、唯一变量是这 71 commit。**
- **它让 agent 省真功**：在「这库有没有向量搜索」这类诚实度敏感任务上，硬化后 agent 稳定 **1 工具调用 / 2 turns**；硬化前因 explore 倒出竞品快照、agent 被迫**多花 ~2 工具调用 / ~2 turns** 去甄别「这些都在 research/repos/、不是本体」。
- **诚实边界**：**正确性全平手**（MiMo 够强，每次都识破快照）——和 round1–6 一致，正确性不是护城河。硬化的价值是**省甄别功 + 消除「被竞品代码带偏」的潜在错误风险**，不是把答案从错改对。
- **更诚实的一条**：竞品快照 `research/**/repos/` 是 **gitignored**，coding agent 的 Grep（ripgrep）默认尊重 gitignore → **grep 根本看不到快照**。所以「快照抑制」**对 grep 不构成护城河**（两边都干净）；它修的是 **omniweave 自己**——omniweave 索引了 grep 看不到的快照，硬化前会把它们泄漏进 agent 视野（一度**比 grep 还差**），硬化后追平 grep 的干净度。

**一句话**：这一跑（71 commit 的输出诚实化部分）让 agent 在「空结果 / 特性是否存在 / 竞品快照同名」类任务上，**从「被 omniweave 倒 24K 竞品快照、要多花 ~2 调用甄别」变成「1 调用拿干净答案」**；它把 omniweave 在这些任务上从「比 grep 还脏」修到「和 grep 一样干净 + 多一层恢复指引」。

---

## 方法学（两层，唯一变量都被隔离）

**被测物**：当前 `HEAD`（输出诚实化已落地）vs `fc91305`（= `ec6d0eb^`，即那 71 commit 的前一个 commit）。
schema 在这两点**完全相同**（`git diff fc91305 HEAD -- src/db/schema.sql` 为空，`user_version=0`），所以**两个二进制读同一个 `.omniweave` 索引**，无需重新索引——这把「索引差异」从变量里彻底排除，唯一变量是这 71 commit 的输出层代码（`src/mcp/tools.ts` +1373 行、`src/context/index.ts` +203 行）。

**Layer 1 — 确定性输出 diff（无 LLM、可秒级复现）**：同一组诚实度触发查询，分别用两个二进制的 CLI 跑（只读，DB mtime 实测不变），diff agent 会看到的输出。产物 `deterministic/*.{new,old}.txt`。

**Layer 2 — agent A/B（真 LLM 行为后果）**：用本机 **MiMo（mimo-v2.5-pro，Anthropic 协议）**驱动 headless `claude -p`，三 arm 唯一变量是 MCP 配置：
- `new` = omniweave HEAD（`serve --mcp`）
- `old` = omniweave `fc91305`（同索引）
- `grep` = 空 MCP（仅内建 Grep/Read/Bash）

量 **工具调用数 / turns / input token / 正确性**。原始 jsonl 在 `raw/`。

**关键方法学注记（诚实标注，防自我灌水）**：
1. **standard 模式**：MiMo 是第三方 Anthropic 兼容代理，域名检查使 ToolSearch 门控对它静默失灵；用 `ENABLE_TOOL_SEARCH=auto:100`（standard 模式：工具 schema 全量直发）让 MiMo 能触达 MCP 工具。这与默认门控形态（round6 实测 +682 tok）不同——但本轮测的是**输出诚实度轴**（工具调用/read/甄别功），不是形态税；三 arm 同模式，唯一变量是 MCP，比较公平。**token 是次要信号**（受缓存与 standard-mode schema 注入干扰），**工具调用数/turns 是可靠努力信号**（沿用 round6 §0.5）。
2. **MiMo 是 judge**：弱于 sonnet。round6 结论「弱模型护城河更宽」——但也意味着 MiMo 可能比生产 agent 更/欠谨慎，是趋势信号非统计显著。
3. **样本小**：每任务 N=2、单仓（OmniWeave 自身）。是隔离因果的趋势信号。
4. **靶仓特殊性**：OmniWeave 仓**故意内嵌竞品快照**于 `research/**/repos/`（且 gitignored）。这放大了「快照泄漏」触发面；普通用户仓没有这种内嵌竞品源，所以**快照抑制的收益对普通仓更小**——见 TL;DR 末条的诚实边界。

---

## Layer 1 — 确定性输出 diff（current HEAD vs fc91305，同一索引）

每行 = 同一查询、同一索引，唯一变量是这 71 commit。`snap` = 输出里 `research/**/repos/` 竞品快照路径的命中数。

| 查询 | OLD 字符 | NEW 字符 | OLD snap | NEW snap | 这 71 commit 修了什么 |
|---|---:|---:|---:|---:|---|
| `explore` **不存在的符号** `zzqxq…` | **24,273** | **558** | **5** | **0** | 空结果不再倒竞品快照源码；改回成功形恢复指引 |
| `explore "vector embedding … search"`（问本体没有的特性） | 18,639 | 24,725 | **7** | **0** | 不再把竞品 `Embedder`/`semantic-search-mcp` 当本体；领先 first-party `VectorError` |
| `explore ToolHandler`（同名碰撞符号） | 25,302 | 23,683 | 1 | **0** | 普通查询不再泄漏快照源码 |
| `node X --file src/…`（取指定文件的符号体） | **299**（stub） | **15,039**（全源码） | 1 | 0 | 尊重 `--file` 提示 + 默认 `includeCode`，一次取源、不逼 agent 回退 Read |
| `callers handleExplore` | 240 | 866 | 1 | 2 | 按定义分组 + 类限定 + continuation key（诚实消歧，非抑制） |
| `impact ToolHandler` | 15,192（领先快照） | 11,017（领先 first-party、分组） | 34 | 42 | 「14 个不同定义、各自 blast radius、可 `--file` 窄化」；first-party 优先 |

**读法**：
- **前 4 行 = 干净的快照抑制 / 取源**（NEW snap = 0）。最戏剧的是第 1 行：硬化前对**不存在的符号**倒 24K 竞品快照（一个查空的 agent 被喂满竞品 `Symbol`/`Embedder` 源码，~6K token 全是噪声 + 误导）；硬化后 558c 干净恢复。
- **后 2 行（callers/impact）= 诚实消歧**：NEW 的快照命中数甚至更高，因为它**诚实列出全部同名定义**（first-party 优先、分组、可窄化），而不是 OLD 那样把快照 def 和 first-party 混在一坨/领先快照。这是「可用性 + 不假装完整」的改进，不是抑制。

---

## Layer 2 — agent A/B：任务 1「这库有没有向量搜索」

**Q**：`Does this codebase implement vector or embedding-based semantic search? If yes, name the class/module and its file:line. If no, state clearly that it does not.`
**Ground truth**：**没有**。OmniWeave 是 lexical/structural（FTS5 + 图遍历）；唯一与 vector 沾边的是 `src/errors.ts` 里**保留的兼容 error 类 `VectorError`**（注释：`core OmniWeave does not run embeddings`）。这正是产品红线（不做向量召回当结构事实）。

| arm | 工具调用(均) | turns(均) | input tok(均) | 正确性 | 工具序列 |
|---|---:|---:|---:|---|---|
| **new**（HEAD） | **1.0** | **2.0** | **77.3K** | 2/2 ✓ | `explore`×1（两 run 同值，极稳） |
| **old**（fc91305） | 3.0 | 4.0 | 94.9K | 2/2 ✓ | r1: explore+Grep；r2: explore+search×3 |
| **grep**（内建） | 5.5 | 6.5 | 149.4K | 2/2 ✓ | Agent(子)×1 + Grep + Bash×3 |

**判读**：
- **new vs old（隔离这 71 commit）**：NEW 稳定 1 调用/2 turns。OLD 的 explore 倒出竞品 `Embedder`/`EmbeddingVector`/`semanticSearch`，agent **被迫多做 ~2 工具调用 + ~2 turns** 去确认「这些都在 `research/.../repos/`、是竞品研究资料不是本体」（agent 原话）。**硬化省掉这层甄别功。**
- **new vs grep（re-confirm round1–6）**：omniweave 砍 **~82% 工具调用 / ~69% turns / ~48% input token**。注意此处 omniweave **连 input token 都更省**（77K vs 149K）——与 round1「单点题 omniweave 贵 44%」不矛盾：这是「全库找特性」的 survey 题，grep 要多词 grep + 派子 agent + 读文件才能收敛，正是 round1 说的「链越深，形态税越被抹平」。
- **正确性全平手**：MiMo 够强，每次都识破竞品快照。**硬化不是把错答案改对，是省甄别功 + 消除「弱/快 agent 会把竞品代码当本体」的潜在错误**（OLD 的 blast radius 字面就领先竞品 `Embedder`——陷阱确实在）。

---

## Layer 2 — agent A/B：任务 2「找计算 embedding 余弦相似度的函数」（missing-symbol 直击）

**Q**：`Find the function that computes cosine similarity between two embedding vectors in this codebase, and show me its file:line and implementation. If there is no such function, say so.`
**Ground truth**：**没有**。`src/` / `__tests__/` 里零 `cosine`；所有命中都在 `research/**/repos/`（semantic-search-mcp / understand-anything / cgc / codanna 等竞品）。

| arm | 工具调用(均) | turns(均) | input tok(均) | 正确性 | 备注 |
|---|---:|---:|---:|---|---|
| **new**（HEAD） | 3.5 | 4.5 | **98.7K**（两 run 同值，极稳） | 2/2 ✓ | 用 `search`（只回位置）→ 一眼看出命中全在 research/repos、上下文不被撑大 |
| **old**（fc91305） | 4.5 | 5.5 | **166.8K** | 2/2 ✓ | 用 `explore` → **倒出竞品余弦相似度源码、上下文比 NEW 多 ~68K token** |
| **grep**（内建） | 5.5 | 6.5 | 149.7K | 2/2 ✓ | 多词 grep + bash 多轮 |

**判读**：
- **最强 token 信号**：当 agent 用 explore（主读原语）时，OLD 倒出竞品余弦相似度全文 → input **~167K**，比 NEW **多 ~68K token** 的竞品源码（agent 得读完再甄别「这些在 research/repos」）。NEW 的 explore 已抑制快照，上下文稳在 ~98.7K。
- **诚实标注（工具选择方差）**：这一题 NEW 的 agent 恰好选了 `search`（只回位置、天然克制）、OLD 恰好选了 `explore`（倒源码）——所以 98.7K vs 166.8K **部分**来自工具选择、部分来自硬化。**任务 1 是更干净的隔离**（两 arm 都主用 explore，delta 纯来自硬化）。但底层一致：**OLD 的 explore 会把 grep 看不到的竞品快照倒进 agent 上下文，硬化堵了这个泄漏。**
- **正确性再次全平手**（6/6）：没有任何 arm 把竞品余弦函数当本体答出来——MiMo 够强。硬化省的是**上下文体量 + 甄别功**。


---

## 诚实边界与结论（写进证据，防灌水）

1. **正确性不是护城河，再次坐实**：3 arm × 2 任务全平手。这 71 commit **不改正确性**，改的是**到达正确所花的功 + 不被带偏的安全性**。
2. **快照抑制对 grep 不是护城河**：`research/**/repos/` gitignored，agent 的 Grep 默认看不到。硬化修的是 omniweave **自己曾比 grep 脏**（索引了 grep 看不到的快照、又泄漏进 agent 视野），硬化后追平 grep。**这是「修好自己」不是「赢过 grep」——如实记。**
3. **收益对普通用户仓更小**：本仓内嵌竞品快照放大了触发面。普通仓没有内嵌竞品源，「快照泄漏」的绝对收益更小；但**空结果恢复指引 + node 一次取源 + impact/callers 诚实消歧**对任何仓都成立。
4. **standard-mode 形态注记**：本轮为让 MiMo 触达工具用了 standard 模式，input token 含全量 schema 注入；这不影响**工具调用/turns**这条主信号，但**别把这里的 input token 当默认门控形态的成本**（那是 round6 的 +682）。

### 一句话回答 goal 的「Done when」

> **这一跑（71 commit 的输出诚实化部分）让 agent 在「空结果 / 特性是否存在 / 竞品同名」类诚实度敏感任务上，少绕约 2 个工具调用、少 2 个 turn，并消除了硬化前在 missing-symbol 上倒给 agent 的 24K 竞品快照（→ 省约 6K input token 且消除被竞品代码带偏的风险）。正确性本就与 grep 平手——硬化省的是功与安全，不是对错。**
