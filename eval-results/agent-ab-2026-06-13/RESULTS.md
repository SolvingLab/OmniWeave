# OmniWeave Agent A/B 证值 —— 结果与结论（2026-06-13）

> 方法学、可复现命令见 `METHODOLOGY.md`；每个数字的原始 stream-json 见 `raw/<repo>/`。
> 本轮诚实地**没有**让 OmniWeave「全赢」——这正是它的价值：它精确量出了 OmniWeave 当前形态的**真实边界**。
>
> **➡️ 第二轮（反向 callers / 多跳组合 / S4 动态分派）见 [`round2/RESULTS-round2.md`](round2/RESULTS-round2.md)**——补上本轮"题偏单点、低估 OmniWeave"的缺口；该类题上 OmniWeave **效率 + 成本双赢**（工具省 53%、总成本反超更便宜）。

## TL;DR

在 4 个真实仓库、8 次 headless agent 运行（model=sonnet, effort=high，唯一变量 = 是否挂 OmniWeave MCP）上：

- **正确性：4/4 全平手** —— 8 个回答全部命中 ground truth。即便在 OmniWeave 该独赢的 S4 分派 / polyglot 跨进程场景，grep/read baseline 也到达了正确答案（因为目标字面可 grep）。
- **效率：OmniWeave 省 ~45% 工具调用、~40% agent 往返**（17 vs 31 工具；21 vs 35 turns）达到同一答案。**调用链越深，优势越大**（dplyr 3 vs 12，4×）。
- **成本：OmniWeave 当前贵 ~44%**（$1.086 vs $0.753）—— `ToolSearch` 门控 + MCP schema 注入的**「形态税」**。**链越深，形态税越被 token 效率抹平**（dplyr：input token 反而更少，cost 近持平）。

**一句话**：OmniWeave 当前形态在「单点架构问答」上不构成代差——它把 agent 的**往返**砍掉近一半，但 MCP 形态税吃掉了省下的钱。**瓶颈是形态，不是能力。** 这反向坐实了设计文档 §1.5 的第一约束（往 Aider 进程内甜点区走、别背 daemon/门控开销）。

## 总览（每个数字可在 `raw/` 复核）

| 仓 | 角色 | 正确性 | 工具调用 with/without | turns with/without | cost(USD) with/without | input tok with/without |
|---|---|---|---|---|---|---|
| **DESeq2** | R S4 分派旗舰 | 都对 | **5 / 10** | 6 / 11 | 0.323 / **0.176** | 217.8k / 222.4k |
| **quarTeT** | polyglot 跨进程旗舰 | 都对 | 4 / **2** | 5 / 3 | 0.255 / **0.104** | 194.0k / 90.9k |
| **ky** | 纯 TS 中性对照 | 都对（with 更精） | **5 / 7** | 6 / 8 | 0.273 / **0.248** | 234.4k / 155.0k |
| **dplyr** | 深调用链（疑 NSE） | 都对 | **3 / 12** | 4 / 13 | **0.235** / 0.225 | **147.3k** / 241.4k |
| **合计** | | **4/4 平手** | **17 / 31**（省 45%） | **21 / 35**（省 40%） | 1.086 / 0.753（贵 44%） | — |

> with arm 每次第一步被迫 `ToolSearch` 加载 MCP 工具 schema（Claude Code 2.x deferred-tool 门控），这是固定形态成本。

## 逐仓判定

### 1. DESeq2 — S4 分派（OmniWeave 该赢）
- **Ground truth**（`omniweave explore estimateDispersions`）：`estimateDispersions` generic（BiocGenerics）→ `setMethod(..., "DESeqDataSet", estimateDispersions.DESeqDataSet)` @ `methods.R:704/500` → 首个实质调用 `estimateDispersionsGeneEst()` @ `methods.R:556`。
- **with（5 工具）**：一次 `explore` 即拿到 method 位置 + blast radius + verbatim 源码，再细化一次 + grep 验证 + Read 确认。**答对**。
- **without（10 工具）**：grep 了 **7 次** 试各种 `setMethod.*`/`setGeneric.*` 正则 + Read methods.R 3 次。**答对**。
- **判定**：正确性平手；OmniWeave 少绕一半路。`setMethod` 字面可 grep 是 baseline 能赢的根因。

### 2. quarTeT — polyglot 跨进程（OmniWeave 该赢）
- **Ground truth**（`omniweave callees quartet.py` 一次列出 4 条 crossLang 边）：`quartet.py` `__main__` 第 30-31 行 `subprocess.run(['python3', f'{sys.path[0]}/quartet_assemblymapper.py'])` → `quartet_assemblymapper.py`。
- **with（4 工具）**：答对，还多追一层（`quartet_assemblymapper.py → quartet_util.run` 进程内调用）。
- **without（2 工具）**：**也答对**，只 grep 2 次——subprocess 字符串里**脚本名是字面的**（仅目录前缀 `{sys.path[0]}/` 是 f-string），`grep assemblymapper` 一击命中，且更快更省。
- **判定**：正确性平手；**这道单点题 grep 反而更优**。OmniWeave 的结构价值（一次 `callees` 拿全 4 条跨进程边）在「找一个答案」上发挥不出来。

### 3. ky — 纯 TS 中性对照（OmniWeave 不该占优）
- **Ground truth**：timeout `source/utils/timeout.ts`（`setTimeout`+`AbortController`，**非 `Promise.race`**，注释标明是 issue #91 的 workaround）；retry `source/core/Ky.ts` 的 `#calculateRetryDelay`/`#retryFromError`。
- **with（5 工具）**：答对，且**更精确**——捕捉到「非 Promise.race / #91 workaround」细节（`explore` 返回带注释的 verbatim 源码）。
- **without（7 工具）**：答对，但描述用了不够准的「Promise.race 竞争」措辞（Read 了代码但漏看注释语义）。
- **判定**：正确性平手，**质量 with 略胜**；工具/turns with 略少，cost 接近。中性场景如预期无代差。

### 4. dplyr — 深调用链（原以为击中 NSE 天花板）
- **Ground truth**（`omniweave explore mutate`）：`mutate` @ `mutate.R:145`（S3 generic）→ `mutate.data.frame` @ :171 →（`compute_by` + `mutate_cols` :253 → `mutate_col` :303 → `DataMask$new` C 层 lazy chop → `mask$eval_all_mutate` @ `data-mask.R:115` → C 层 `dplyr_mask_eval_all_mutate` 逐组 `eval_tidy`）。
- **with（3 工具）/ without（12 工具）**：**两边都答对、都完整**。
- **判定**：正确性平手；**OmniWeave 工具效率最大优势仓（3 vs 12，4×），且 cost 持平、input token 反而更少**。
- **方法学澄清**：这道题问的是**函数调用链**（静态可追），不是用户表达式如何在 data mask 里求值（那才是不可解的 NSE）——所以没翻车。**这道题没真正击中 NSE 天花板。**

## 三条硬结论

1. **能力（正确性）已够用，不是瓶颈**。OmniWeave 在它最强的 S4/polyglot 场景没能把正确性拉开代差——grep baseline 全部追平。继续堆第 N 类边（Makefile / 多语言）**不会改变单点问答的胜负**。
2. **OmniWeave 的真实净价值 = 省往返**，且**随调用链深度放大**（dplyr 4× 工具差）。它最适合的不是「找一个字面符号」，而是「**追深链 / 拿全集 / 走不可字面 grep 的边**」。
3. **形态税是当前的真问题**。`ToolSearch` 门控 + MCP schema 在短题上让 cost ~2×（DESeq2/quarTeT），在深题上被 token 效率抹平（dplyr 近持平）。**砍形态税 → 省下的往返才能转化为省钱省时 → net-positive。**

## 这对「下一步」的反向定位

用户原问「下一阶段砸形态还是砸能力」。**数据指向砸形态**：
- 能力（正确性）已追平 grep，再加边对单点问答无增量。
- 瓶颈是形态税（MCP schema + ToolSearch 门控）吃掉了省下的往返。
- 把形态往设计文档 §1.5 的 **Aider 甜点区**做（进程内查询、零门控固定开销、token 预算感知裁剪输出），让「省 45% 往返」真正转化为「省钱省时」，OmniWeave 才从「边际省往返、净贵 44%」变成「又快又省」。

## 诚实的方法学边界（写进证据，防自我灌水）

- **样本小**：4 仓 / 8 run，headless 单 prompt。是趋势信号，不是统计显著性。
- **题型偏单点**：4 道题都偏「找一个答案」，正中 grep 主场，**没测 OmniWeave 真正该独赢的多跳组合 / 全集枚举 / 不可字面 grep 的边**——下一轮必须补这类题，否则低估 OmniWeave。
- **dplyr 没击中 NSE**：所选题是可追的函数调用链，非 NSE 分派；真正的 NSE 天花板（data mask 内表达式求值）未被测到。
- **cost 受干扰**：raw token in/out 受 prompt 缓存与 cache-creation 影响；工具/turns 计数是更可靠的努力信号（harness 作者注，已采纳）。
- **首跑踩坑（已修，留证）**：第一次矩阵全 8 run 因 `401 authentication_failed` 空跑——runner 误清了 harness 注入认证的本地代理（`HTTP_PROXY=127.0.0.1:55779`），导致 `claude` 子进程拿不到 bearer token。证据见 `raw/console-firstrun-401.log` / `raw/DESeq2/audit-firstrun-401.log`。修复 = 不动代理、继承环境。**这条踩坑本身印证铁律：rc=0 ≠ 成功，必须看真实输出。**

## README 素材（英文，可直接粘贴 / 裁剪）

> **Does an agent actually do better with OmniWeave?** A/B benchmark, 4 real repos, 8 headless runs, sonnet/high, OmniWeave-MCP vs plain grep/read as the only variable.
>
> | | with OmniWeave | plain grep/read |
> |---|---|---|
> | Correct answers | 4/4 | 4/4 |
> | Tool calls (total) | **17** | 31 |
> | Agent turns (total) | **21** | 35 |
>
> **OmniWeave cut agent tool-calls ~45% and round-trips ~40% to reach the same correct answer.** The deeper the call chain, the larger the edge — on dplyr's `mutate()` chain, **3 tool calls vs 12**. Today it costs ~44% more (MCP schema + tool-gating overhead); that "form-factor tax" is fully amortized on deep-chain queries (dplyr: fewer input tokens, near-equal cost) and is the next thing to cut.
>
> Honest caveats: small sample; queries were single-point lookups (grep's home turf) — OmniWeave's structural wins (whole-set enumeration, cross-process edges grep can't follow) were under-tested and are next.
