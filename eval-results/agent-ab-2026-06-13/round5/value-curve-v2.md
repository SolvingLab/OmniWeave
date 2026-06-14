# OmniWeave 价值曲线 v2 —— 五轮汇总（验收3，2026-06-14）

> 在 round4 `../round4/value-curve.md`（四档×三基线×多维）之上，并入第五轮的两个新维度：
> **「跨进程×大仓」**（轨道A）与**「查询类型路由前/后」**（轨道B）。
> 累计：~50 headless A/B run + 15 仓 size/chain 实测（round5）+ 前四轮 ~60 run / 8 仓 / 5 语言 /
> 2 模型 / 3 基线。判分人工、ground truth 可枚举。

## 主表：四档查询 × 三基线（含 round5 修订）

| 档 | 题型代表 | 仓规模 | 正确性 (vs grep) | 工具效率 | 成本 | 备注 |
|---|---|---|---|---|---|---|
| ① 单点定位 | DESeq2/quarTeT/ky | ≤450 | **平手** | 省 45% | +44%* 缓存伪影 | **轨道B 路由消除形态税（见下）** |
| ② 反向/多跳/动态分派 | 同 4 仓 | ≤450 | 平手 (DESeq2 更全) | 省 53% | −16% | |
| ③ 大仓反向全集+impact | django 3k / vscode 11.5k | 3k–11.5k | 平手 (都完整) | **省 94%/96%** | **−64%/−76%** | 同语言反向：**赢随规模单调放大** |
| ④a 结构不可grep（同进程） | guava 分派 / django 深传递 | 3k–11.5k | 平手 (分歧假设证伪) | 看题 | 看题 | round4 |
| **④b 跨进程 × 小仓** | **quarTeT (7 文件)** | ≤450 | 平手 (6/6) | **省 ~20%** (6.3 vs 8) | with 略贵（小仓税） | round4：crossLang 边 fire → 小赢 |
| **④c 跨进程 × 大仓** ⟵新 | **MAESTRO (1,729 文件)** | ≥1000 | **平手** (with 2full+1过包含 / without 3full) | **平手** (11.7 vs 12.3) | **平手** ($0.174 vs $0.182) | **round5：win 蒸发** ⟵关键修订 |

\* round1「+44%」经 round3 量化为单点小分母 + prompt 缓存伪影（同配置冷/暖差 56×），非稳定美元税。

## 关键修订：跨进程的赢曲线是「驼峰」不是「单调放大」

round4 把跨进程归进档④并暗示其效率护城河同档③一样随规模放大。**round5 实测证伪了这个外推**：

| 维度 | 同语言反向（③） | 跨进程（④b→④c） |
|---|---|---|
| 小仓 | 省 45–53% | quarTeT 省 ~20%（crossLang fire） |
| 大仓 | **省 94–96%（放大）** | **MAESTRO 平手（蒸发）** |
| 曲线 | **单调↑** | **驼峰：小仓有、大仓无** |

**根因（`ground-truth-largepolyglot.md` 实证）**：同语言反向查询在大仓有「O(命中) 文件要读」的暴力成本，OmniWeave 的 O(1) callers 单调放大省的量。**跨进程不同**——OmniWeave 赢的「干净静态多跳兄弟脚本链」（quarTeT 式）**只存在于中小 CLI 套件**；大仓（galaxy/cgat/ganga/ansible…）的跨进程要么是 Snakemake/Nextflow（已处理、非 grep-gap）、要么是**运行时动态命令串 / 安装目录脚本**（MAESTRO `Rscript %s/x.R`），后者对 grep 和 OmniWeave **都是诚实天花板**——于是大仓上 with-arm 退回 grep、与 without 同构、赢蒸发。

## 三基线对照（grounded，规制=fresh checkout 零配置）—— round5 补 MAESTRO 行

| 能力 | grep+read | OmniWeave | LSP | Aider repo-map |
|---|---|---|---|---|
| 跨进程 × 大仓 (MAESTRO Py→R) | 平手（读可达） | **平手**（crossLang 命中天花板，退回 grep） | **✗ 范畴+环境失明**（无 R server / os.system 串无符号 / pyright 零配置解不了 import） | ✗ |
| （其余行见 round4 value-curve.md，不变） | | | | |

## 轨道B —— 路由前/后曲线（终值）

server-instructions「Match the tool to the query shape」决策树落地（v4，20 行）。前/后 token（可靠信号）：

| 单点子类 | before with | after with | without | 形态税是否消除 |
|---|---|---|---|---|
| 纯元数据（签名/位置，Q2） | explore+read **138k** | **search 92.7k** | grep+read 90k | **✓ 消除**（92.7k ≈ 90k） |
| 复合（位置+body，Q1） | explore 95k | search+read **124–157k** | grep+read 90k | ✗ 不消除（agent find-then-read 2跳 + 固定 MCP ~34k） |
| 反向（Q3，对照） | callers 93k | callers 93k | grep loop | n/a（win 保持） |

**曲线含义**：形态税分两层——**变量层**（explore-过度，纯元数据题上 search 即可，路由可消除）+
**固定层**（MCP server-instructions + 工具 schema + ToolSearch 门控 ≈ 34k，路由不可消除，round4 已定
「不抠固定税」）。路由把变量层削平（Q2 追平 grep），固定层留存（复合单点/小仓多步题上仍 with>without）。
**这是诚实的「针对性帕累托」：可去除处去除、本就赢处不退，agent 行为/固定开销主导处如实标边界。**

## 饱和判定（验收4）

**轨道A（跨进程×大仓）= 已饱和，可停该探索方向。** 论据：
1. **再加仓不改结论**：15 仓实测已覆盖 bio（bcbio/cgat/MAESTRO/galaxy/nipype）、工作流引擎、
   ML/数据（ansible/ganga）、模拟（SU2/mesos）、前端（vscode）——跨进程 idiom 收敛到三类
   （已处理的工作流 / 动态串-诚实天花板 / 安装目录脚本-诚实天花板），**无第 4 类会让 OmniWeave
   在大仓跨进程上拉开**。
2. **再加语言不改结论**：Python/JS-TS/Go（crossLang 覆盖）已测；大型基因组编排器是 Perl
   （caller 不索引），加 Perl 抽取也只是把 caller 接进来，目标仍是动态串/外部二进制。
3. **再加题不改结论**：MAESTRO 已是「最有利于 OmniWeave 的大仓跨进程题」（真实 Python→R、
   可枚举、LSP 范畴失明），仍平手——更难的题只会更平或更不利。
→ **跨进程护城河的诚实边界已钉死：小仓静态链有、大仓蒸发。继续投跨进程×大仓 = 零 ROI。**

**轨道B（形态税路由）= 已饱和到「固定层天花板」。** 论据：
1. **变量形态税已消除**：纯单点元数据题上 explore-过度被路由削平（Q2 追平 grep）——这是可去除的全部。
2. **剩余形态税是固定 MCP 附着开销（~34k）**：server-instructions + 工具 schema + ToolSearch 门控，
   任何 repo、任何题恒定存在；round4 已论证「冷/暖缓存差 56×、稳态 ~1 turn、不值得抠」。**路由到此为止，
   再迭代 prompt（已试 4 版）不能降这层。** 唯一能降固定层的是**形态本身**（进程内/嵌入式、去 ToolSearch
   门控），属 §1.5 约束①的更大工程，非本轮 prompt 层范畴。
3. **agent find-then-read 习惯是模型行为、非可路由项**：复合单点题（where+body）4 版路由均稳定 2 round-trip。
→ **路由层已达其设计天花板：变量层削平、固定层留存。再投 prompt-routing = 零增量。下一步形态投资应转向
   「降固定层」（进程内甜点区，§1.5①）或「输出精度」（round3 qualified_name / round4 impact 截断范式）。**
