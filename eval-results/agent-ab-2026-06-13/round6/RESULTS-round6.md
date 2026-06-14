# OmniWeave 证值 —— 第六轮「形态换层·终局饱和·零妥协」(2026-06-14)

> 前五轮（`../round5/RESULTS-round5.md` 等）已饱和地证：**正确性全档追平 grep（含虚分派/跨进程/
> 深传递）、护城河=效率/token 随规模放大、vs LSP 同语言平手+跨边界赢、跨进程×大仓蒸发(NO-GO)、
> prompt-routing 到顶**。第六轮是**收口轮**，攻 round5 终建议点名的「换层」前沿，四轨：
> ①输出精度审计第三例 ②弱模型护城河矩阵 ③降固定层 de-risk ④终局裁定。
> 协议同前：唯一变量=是否挂 OmniWeave（轨道3 再隔离 ToolSearch 门控这一变量），model=sonnet
> effort=high（轨道2 加 haiku），判对错=人工（提两 arm 答案 + DB/grep 建可枚举 GT + 逐项判）。

---

## 轨道 1 —— 输出精度审计第三例（callers/callees 截断 + import 噪音）

### 1.0 系统审计：每个 MCP 工具的输出截断/噪音信号

范本=round3 `qualified_name`（callers 补 owning class）、round4 `impact` 深度截断信号。本轮系统过一遍
`src/mcp/tools.ts` 全部 formatX，逐工具核对「截断是否显式、计数是否诚实、有无 agent 得二次推导的噪音」：

| 工具 | 截断/计数信号现状（审计前） | 判定 |
|---|---|---|
| `explore` | 源码段 +N more / "Not shown above" / budget 提示；blast-radius `FILE_CAP +N more` | ✓ 已到位 |
| `node` | trail `+N more`（TRAIL_CAP）；body outline `+N more (signatures elided)` | ✓ 已到位 |
| `impact` | round4 深度截断信号 `⚠️ Partial — stopped at depth N; re-run depth=N+2` | ✓ 已到位 |
| `search` | 列全部命中、`(N found)` | ✓ |
| **`callers`/`callees`** | **`slice(0,limit)` 截断但标题 `(N found)` 报的是切片后长度（谎报）、无 re-run 提示** | **✗ 缺口 A** |
| **`callers`/`callees`** | **把 file 级 `imports` 边当 caller 列出，`(N found)` 虚高，agent 被迫手动剔除** | **✗ 缺口 B** |

**审计结论**：`explore`/`node`/`impact` 三个工具的截断信号 round3/4 已补齐；**唯独 callers/callees 有两个缺口**
（截断谎报 + import 噪音），且正落在 OmniWeave 宣称该赢的**高扇入反向查询**上。这是输出精度审计第三例。

### 1.1 缺口 A —— limit 截断谎报（`slice(0,limit)` + 标题报切片长度）

`handleCallers`/`handleCallees` 单定义分支：`formatNodeList(callers.slice(0,limit), …)`，标题
`## … (${nodes.length} found)` 的 `nodes` 是**已切片**数组 → 默认 limit=20 时，70 个 caller 的符号
报「(20 found)」，**无任何「还有 50 个、re-run limit=70」信号**。与 round4 impact 截断完全同构，却是 callers/callees 的盲区。

**修复**（`src/mcp/tools.ts`，零回归）：
- `formatNodeList` 改为**内部切片**（接全量 list + limit），标题诚实：截断时 `(showing 20 of 70)`、未截断 `(70 found)`。
- 新增 `moreResultsNote(total, shown)`：`> ⚠️ Showing the first 20 of 70 — re-run with \`limit=70\` for the full list.`（>100 的 hub 说 `top 100 (this symbol is a hub: N total)`）。
- 多定义分支每 section 同样补 footer。CLI `callers/callees` 同步（json 加 `total`/`truncated`、人读加 `… N more` 行）。

**红→绿门禁**（`__tests__/callers-truncation.test.ts`，5 用例）：受控 fixture 25 个 distinct caller > limit 20。
pre-fix 源码 **4 failed | 1 passed**（唯一通过的是 limit=100 无截断对照），post-fix **5/5 green**。

### 1.2 缺口 B —— import 噪音当 caller（real-run 验证，最高 ROI）

`getCallersRecursive` 的边集含 `'imports'` → `callers` 把「文件 import 了这个名字」的 file 级 import 边
当 caller 列出。**真实 run 实测（vscode `checkProposedApiEnabled`，见 1.3）**：工具返回
`## Callers of checkProposedApiEnabled (80 found)` = **57 个真函数 caller + 23 条 file 级 `via import`**，
每条 import 都在「同时也调用它」的文件里（与函数 caller 冗余）→ agent 被迫手动推导「80−23=57」。

**修复**：`handleCallers`/`handleCallees` 的 `collect()` 跳过 `c.edge.kind === 'imports'`（import 是依赖、不是调用）。
`node` trail 的 collect() 同步过滤（全局一致）。**依赖闭包（含 importer）保留在 `omniweave_impact`**（`getImpactRadius`
用无 kind 过滤的 `getIncomingEdges` → importer 信息零丢失，只是搬到正确的工具）。语义分工：
**callers/callees = 谁调用/用 X；impact = 谁依赖 X（全闭包）**。

**红→绿门禁**（`__tests__/callers-import-filter.test.ts`，3 用例）：跨文件 fixture（widget 被 import 且被 call）。
断言①图层确实记录了 import 边（过滤是真活）②callers 列真 caller、无 `via import`/`(file)`、`(2 found)` 而非 4
③impact 仍见 importer。pre-fix **1 failed**（关键断言）| post-fix **3/3 green**。

### 1.3 A/B 实测（vscode `checkProposedApiEnabled`，57 distinct callers）

**可枚举 GT**（DB 直查）：单定义 function（extensions.ts:330）；`calls` 边 = 351 条 callsite，**去重后 57 个
distinct caller node**；grep `checkProposedApiEnabled` = 351 hits（without-arm 需读/去重 351 处才得 57）。

题（公平，without-arm 能 grep）：「本仓有多少个不同函数/方法调用 `checkProposedApiEnabled`？给精确总数 + 每个 caller 的文件。」

#### A/B 实测（sonnet/high，3 run/arm，2026-06-14）

| arm | 工具数 | omniweave 用量 | turns | cost | agent 报的总数 | 备注 |
|---|---|---|---|---|---|---|
| **with-before** r1 | 2 | callers×1 (limit:200) | 3 | $0.235 | 57 | 工具「**(80 found)**」→ 手动剔 23 import |
| with-before r2 | 2 | callers×1 (limit:200) | 3 | $0.244 | 57 | 同上（明示「去掉 23 条 file via import」） |
| with-before r3 | 2 | callers×1 (limit:200) | 3 | $0.210 | 57（或合并 50） | 同上 |
| **with-after** r1-3 | 2 | callers×1 (limit:200) | 3 | $0.16-0.19 | 57/50 | 工具「**(57 found)**」直读、**无 import 减噪**（agent 合并 getter/setter→50） |
| without r1 | **106** (44 Bash+1 Agent+61 Read) | grep | 17 | **$2.857** | **136** | grep 351 hit 逐读，撞 brace-count，过度细分 |
| without r2 | 8 (Bash) | grep | 9 | $0.374 | **206** | 另一粒度（233 callsite / 206 函数级） |
| without r3 | **127** (41 Bash+1 Agent+85 Read) | grep | — | **撞预算 $4** | （未完成） | grep 太贵，撞 --max-budget-usd 4 |

#### 决定性回答（诚实，非 cherry-pick）

1. **Gap B 修复生效（工具输出层，实测 token）**：callers 工具结果从 `(80 found)`（57 真 caller + 23 file import）变为
   **`(57 found)`**（import 噪音消失）——**工具结果 9,524 → 6,395 字符（−33%）**。with-after 的 agent **不再做「80−23
   减噪」推导**（实测答案无 import 减法）；3-run 均值：**输入 token 96,327 → 95,131、输出 token ~10,315 → ~8,842（−14%）、
   cost $0.230 → $0.178**。**零正确性损失**（caller 集合不变，57/50 是 getter/setter 解释、与修复正交）。
2. **效率护城河巨大且稳定**：with = **2 工具 / 3 turns / $0.21-0.24，三次零方差**；without = **8–127 工具 / 9–17 turns /
   $0.37–$2.86（一次撞 $4 预算上限未完成）**。这是 round3 vscode 护城河的复现 + 强化。
3. **诚实纠偏：这题的"正确性"是粒度歧义、不是 OmniWeave 更对**。三 arm 答案发散（with 57/50、without 136/206/撞预算）——
   根因是 `checkProposedApiEnabled` 的 caller 主要是 `extHost.api.impl.ts` 一个工厂函数内的 ~136 个匿名 getter/setter，
   **「有多少 distinct caller」在这种工厂代码里本身就是粒度题**。OmniWeave 给**节点粒度的稳定 57**（每次一致），
   grep 给字面 accessor 的 136/206（每次不同）。**这不是「OmniWeave 更正确」，是「OmniWeave 答案稳定 + 省 1-2 个数量级
   努力」**。不包装成正确性独占（铁律 §0.6）。
4. **缺口 A（截断谎报）在 sonnet 上未咬到**：agent 主动传 `limit:200` 绕过默认 20 截断。它的价值在**不主动调高 limit
   的弱模型**（轨道2 验证）+「(showing 20 of 70)」严格优于谎报「(20 found)」（红→绿 vitest 已证）。

---

## 轨道 2 —— 弱模型护城河矩阵

详表见 `weak-model-matrix.md`。四档题型 × haiku（+ sonnet 同题对照）× 3 run，judge 人工 + DB GT。

**HAIKU 矩阵（工具数 / 输入 token 均值；正确性全平手）**：

| 档 | WITH | WITHOUT | 护城河 |
|---|---|---|---|
| ① 单点 (DESeq2 sig) | 3.3 / 145k | 3.0 / 127k | **负**（grep 主场） |
| ④ 跨进程·小仓 (quarTeT) | 2.3 / 106k（omni=0） | 2.0 / 93k | **中性**（haiku 7 文件直接 grep，没调图） |
| ② 反向 (django iri_to_uri) | 4.5 / 178k（1 次 48 工具 flail） | 13 / 301k | **~3× 工具** |
| ③ 大仓 blast (django get_srid_info) | **2.3 / 96k** | **~26 / 66k–1.73M** | **~11× 工具** |

**护城河随查询结构单调变宽**（单点负→小仓跨进程中性→反向 3×→大仓 blast 11×），与 sonnet 同形。
**正确性全档平手**（blast with 28/without 31-32，reverse ~17 both，single both core.R:1333）——延续六轮「护城河=effort 非正确性」。

**弱模型三诚实发现**：
1. **工具选择不可靠 → 护城河「期望更宽、方差更大」**：reverse 一次 48 工具/2.4M/**omni=0**（haiku 无视挂着的图自己 grep flail，仍答 16）。护城河只在弱模型真选图时兑现。
2. **without flail 绝对成本更高**：blast without haiku 17-32 工具（round3 sonnet django impact without 31，但 haiku token 更失控）。
3. **小仓跨进程 haiku 不用图**（omni=0），印证 round5「小仓 grep 够」。

**SONNET 同题对照 → 「护城河 vs 模型强度」曲线（本轨最重要的诚实发现）**：

| blast 档 without | HAIKU | SONNET |
|---|---|---|
| 工具数 | ~26 | ~39（并行更多） |
| 输入 token | **66k–1.73M（方差极大）** | **65k（稳定）** |
| turns | 2/18/33（不稳） | 2/2/2（稳） |

- **WITH 图：两模型坍缩到 ~2-3 工具/3 turns**——图抹平模型强度差异。
- **「弱模型护城河更宽」依指标分裂**：工具数维度两者都宽（强模型并行反更多）；**token/turn 维度弱模型显著更宽**——
  强模型靠并行 grep 压住 without 成本（65k/2turns），弱模型退化为串行 flail（最坏 1.73M/33turns），图把两者拉回 ~94k。
- **反向折扣**：弱模型捕获不可靠（haiku 1/3 run 无视图自己 flail）→ **潜在护城河更宽、实际捕获率更低、方差更大**。
- **精化 round4**：「haiku without 13 vs sonnet 7.7」的差异主要在 **token/turn（串行 flail）非工具数（强模型并行）**，且要打捕获率折扣。详表见 `weak-model-matrix.md`。

---

## 轨道 3 —— 降固定层 de-risk

### 3.0 固定层静态分解（实测，2026-06-14）

「单点题 with > without 那 ~34k」逐项拆开（`dist/` 字节 ÷ 4）：

| 层 | 来源 | 谁控制 | 实测 token |
|---|---|---|---|
| server-instructions | `server-instructions.ts`（每 session 进系统提示） | **OmniWeave** | **~2,397** |
| 默认 5 工具 schema | search 197 / callers 188 / impact 171 / **node 634** / explore 339 | **OmniWeave** | **~1,529** |
| ToolSearch 门控 | deferred 名单 + ToolSearch 工具 + 门控往返 | **客户端** | 余下大头（不可控） |

**关键拆分**：固定层 = OmniWeave 自身可降文本（~3.9k）+ 客户端 ToolSearch 门控（OmniWeave 不可控）。
round5「prompt 不可降」是对的，但**「prompt 不可降」≠「不可降」**——OmniWeave 那 3.9k 可裁 schema/instructions，
客户端门控可靠用户配 `ENABLE_TOOL_SEARCH` 旁路。

### 3.1 ToolSearch 门控隔离 A/B（候选②）—— **决定性反转 + 重大诚实纠偏**

隔离 A/B（DESeq2 单点签名题，两臂都挂同一 omniweave MCP，唯一变量=`ENABLE_TOOL_SEARCH`）：

| arm | 工具 | turns | first-turn 固定附着 | session 输入 token | ToolSearch 调用 |
|---|---|---|---|---|---|
| **gated**（默认门控，schema deferred） | 2（ToolSearch+search） | 3 | **30,525** | ~92.7k | 1 |
| **eager**（`ENABLE_TOOL_SEARCH=auto:100`，schema 全载） | 1（直接 search） | 2 | **46,464** | ~97.5k | 0 |

**反转结论①：关门控不省 token，反而 +16k（first-turn）/ +4.7k（session）**。门控通过 defer 所有工具 schema
（含内置工具）省系统提示；关掉则全部 eager 载入。**round4/5 假设「关门控省往返→省钱」对延迟成立（−1 turn）、
对 token 证伪（+16k）。门控已是 token 最优。候选② = NO-GO（关掉更贵）。**

**反转结论②（重大诚实纠偏）：round5 的「~34k 固定 MCP 层」绝大部分是 base Claude Code harness、不是 OmniWeave。**
同题（DESeq2 单点）同模型（haiku）两臂 warm first-turn 实测：

| arm | warm first-turn 固定附着 |
|---|---|
| **without omniweave**（grep，mcp-empty） | **30,586** |
| **with omniweave**（gated 默认） | **31,268** |
| **OmniWeave 边际固定成本** | **+682 tok** |

那 ~30k first-turn 在**两臂都存在**（内置工具 deferral + ToolSearch 机制 + base 系统提示）——是 harness 的、不是
OmniWeave 的。**OmniWeave 默认门控下的边际固定成本 ≈ 682 tok**（schema 被 defer 不进系统提示，server-instructions
约束被基座 boilerplate 大部分摊薄）。round5「单点 with>without ~34k 固定税」是把 base harness 误记成 OmniWeave 的；
**真实边际 ~682 tok first-turn / ~2.7k session**。stream-json 不回显系统提示，故只能靠 token 计数测（已实测）。

**候选①（裁 server-instructions / schema）**：既然边际只 ~682 tok，裁字节的 ROI ≤ 682 tok 且风险大（server-instructions
带 round5 路由+工具选择 playbook，schema 默认已 deferred）→ **不裁**（ROI 不抵差异化风险）。

### 3.2 进程内/嵌入式 mode de-risk

见 `in-process-mode-derisk.md`。**终判：设计就绪、本轮不建**——路径 A（库）无第二方宿主 testbed（赌不存在的集成方，§0.17 红线）；
路径 B（hook 注入）ROI 上限=~34k 且自带「预注入放大 find-then-read」新风险（给出 §5 最小原型 + GO 判据）；
路径 C（门控旁路）零工程、已 A/B 量化，作为「立即可用的固定层缓解」写进文档。

---

## 轨道 4 —— 终局裁定

定稿见 `FINAL-RECOMMENDATION.md`（v3）。核心：

- **全球最好的天花板（已钉死的交集）**：在「**同语言大仓反向/blast-radius + 跨边界结构（LSP 盲区：跨语言/跨进程/动态分派）+ 零配置 + 弱模型**」这个交集里，OmniWeave 是可辩护的最省形态。交集**之外**（正确性、跨进程×大仓、强模型同语言单点、固定层）它诚实平手或有微小成本。
- **一句话定位 v3**：「同样正确、同语言大仓更省（1/20 工具、1/12 token，随规模放大）、跨边界 LSP 够不着、零配置、对弱模型在 token/turn 维度尤甚；固定附着开销实测仅 ~682 tok（round5 的 34k 是 base harness）。」
- **README 定稿**：修了 round5「~34k 固定层」的错误声称（→ +682 实测）、补了 round6 弱模型曲线 + callers 精度段、修了「four core tools」doc-bug（→ 默认 5 含 impact）。
- **最终 saturation 论断**：六轮后再加轮/仓/题/语言/模型都不改变结论（逐维论证见 FINAL-RECOMMENDATION §5）。**输出精度饱和、固定层自我消解、护城河曲线定形、正确性决定性平手** → 收口。

---

## 回归门禁（每源码改动逐一实跑，全绿零回归）

- **vitest：1498 passed | 2 skipped**（1490 基线 + Gap A `callers-truncation` 5 + Gap B `callers-import-filter` 3）。
- **tsc --noEmit：0 error**。
- **25 eval 门禁（build 后逐 corpus 实跑）：capstone 10/10、polyglot-subprocess 9/9、deseq2 2/2、workflow 4/4 = 25/25，recall=1.00**。
- 改动文件：`src/mcp/tools.ts`（Gap A+B + moreResultsNote + trail 过滤）、`src/bin/omniweave.ts`（CLI parity）、`__tests__/callers-truncation.test.ts`、`__tests__/callers-import-filter.test.ts`。`omniweave --version`=0.1.0 dev build。
- 改动均在 **MCP 输出层**（eval 门禁查图层，故不受影响，仍逐一实跑确认）。源码改动后无后续源码变更（仅文档/README），门禁有效。
- **未 commit**：源码改动 + README + `eval-results/round6/` 全部留工作区，由用户定夺公开节奏。
