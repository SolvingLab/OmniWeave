# OmniWeave 价值曲线 —— 四档 × 三基线 × 多维（验收5，2026-06-14）

> 汇总四轮 / 36+ headless A/B run / 8 仓（DESeq2·quarTeT·ky·dplyr·django·vscode·guava + fixtures）/ 跨 5 语言（R·Python·TS·Java + polyglot）/ 跨 2 模型（sonnet·haiku）。
> 唯一变量=是否挂 OmniWeave MCP；竞品（LSP/Aider）为 grounded 能力 head-to-head。判分人工、ground truth 可枚举。

## 主表：四档查询 × 三基线 × 多维

| 档 | 题型代表 | 仓规模 | **正确性 (vs grep)** | **工具效率** | 成本 | token | 时间 |
|---|---|---|---|---|---|---|---|
| ① 单点定位 | DESeq2/quarTeT/ky/dplyr | ≤450 | **4/4 平手** | 省 45% (17/31) | +44%* (缓存伪影) | — | 略快 |
| ② 反向/多跳/动态分派 | 同 4 仓 | ≤450 | **3/4 平手** (DESeq2 with 更全) | 省 53% (16/34) | **−16%** | — | 更快 |
| ③ 大仓反向全集+impact | django 3k / vscode 11.5k | 3k–11.5k | **平手 (都 17/17 / 都完整)** | **省 94%/96%** (2/31, 2/47) | **−64%/−76%** | **省 12×** (95k/1.13M) | **3.5×/4.8×** |
| ④ 结构不可 grep | guava 分派 / django 深传递 / quarTeT 跨进程 | 3k–11.5k | **平手 (12/12·平手·6/6)** ⟵ 分歧假设证伪 | 看题 (见下) | 看题 | — | — |

\* round-1「+44%」经 round-3 量化为单点小分母 + prompt 缓存伪影（同配置冷/暖 cache_creation 差 56×），非稳定美元税。

## 档④细分（结构不可 grep，round4 实测，3+3/格）

| 题(类) | 模型 | 正确性 | with 工具 [范围] | without 工具 [范围] | 备注 |
|---|---|---|---|---|---|
| guava 虚分派陷阱 (a) | sonnet | **6/6 平手** | 2 [2-2] | 7.7 [7-9] | OmniWeave 自身边指向陷阱基类，agent 不盲信、自核验 |
| guava 虚分派陷阱 (a) | **haiku** | **6/6 平手** | 2.7 [2-3] | **13 [12-14]** | 弱模型 flail 更狠→省更多 |
| django 浅传递 (b) | sonnet | 6/6 平手 | 6.3 [3-11] | **2 [2-2]** | **grep 反赢**（浅而干净） |
| django 深传递 (b) | sonnet | 平手 | 24 [20-27] | 43.7 [35-57] | impact 被砍→退化递归 callers（→轨道4 修） |
| quarTeT 跨进程 (c) | sonnet | 6/6 平手 | 6.3 [5-8] | 8 [5-11] | 小仓 with 成本更高（形态税） |

## 三基线对照（grounded capability，规制=fresh checkout 零配置）

| 能力 | grep+read | **OmniWeave** | LSP | Aider repo-map |
|---|---|---|---|---|
| 正确性（所有四档） | 基准·韧性极强 | **平手**（不独占） | 同语言平手/范畴失明 | 答不了 |
| TS 同语言 callers/impl | 暴力可达 | 1 调用 | **1 调用（同侪）** | ✗ 无边 |
| Python 零配置 callers | 暴力可达 | **完整** | **✗ 失明**(pyright 0/17) | ✗ |
| 跨进程桥 / 跨语言 | ~读取可达 | **✓ crossLang** | **✗ 范畴失明** | ✗ |
| R-S4 运行时分派结构 | 读 setMethod | **✓ 分派图** | **✗ 范畴失明** | ✗ |
| 效率/成本/token | O(命中) agent 读 | **O(1) 结构查询** | O(1) 但环境依赖 | 一次性 context blob |

## 性能（轨道5，实测）

- **OmniWeave 查询延迟**（CLI 含进程启动；MCP 持久 server 内 per-query 亚毫秒）：vscode(11.5k) `callers` 1.85s / `impact -d3` 0.50s / `explore` 8.58s；django(3k) `impact -d4` 0.23s / `callers` 0.22s。
- **grep -rn**（vscode 单符号扫描）1.20s——**但仅扫描**；agent 还需逐读 26 命中文件（round3 实测：完整 grep+read agent loop = 47 工具/1.13M token/6 分钟）。**性能护城河不是「grep 慢」（grep 扫描快），是「grep 答案需 O(命中) 次 agent 读、OmniWeave 是 O(1) 结构化」。**
- **索引**：vscode 333,804 节点 / 1GB / 4m38s 构建（round3），WAL 增量 + 2s debounce。**vs Aider repo-map**：Aider 每会话用 tree-sitter+PageRank 现建一个 token 预算内的 context blob、不持久化可查图——苹果对橘子：OmniWeave 一次建图、永久亚毫秒查；Aider 每会话重选 context、无持久查询面。

## 曲线形状（单调）

**查询越反向/多跳/大仓，OmniWeave 努力/成本/token/时间优势单调放大**（工具省 45%→53%→94%→96%；成本 +44%→−16%→−64%→−76%）。**正确性在所有四档全程平手**——包括档④刻意构造的结构不可 grep 题。**护城河 = 效率/成本/token（随规模放大）+ 零配置/跨语言（vs LSP）+ 有可走的边（vs Aider）；不是正确性独占。** 唯一例外方向：弱模型（haiku）下努力护城河绝对值更大（弱模型无结构时 flail 更狠）。
