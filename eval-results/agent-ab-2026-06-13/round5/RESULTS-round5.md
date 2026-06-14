# OmniWeave Agent A/B 证值 —— 第五轮「饱和化·零妥协」(2026-06-14)

> 前四轮（`../round4/RESULTS-round4.md` 等）结论：**greppable 题正确性全档平手，护城河=
> 效率/成本/token 随规模放大；vs LSP 同语言平手、零配置/跨语言/跨进程赢；正确性分歧假设被
> 证伪。** 第五轮攻两个缺口：① **跨进程在「大仓」上复测**（round4 的跨进程只在 quarTeT 7
> 文件测过，太小）——轨道A；② **查询类型路由消除单点形态税**——轨道B。
> 协议同前：唯一变量=是否挂 OmniWeave MCP（轨道B 再隔离 server-instructions 路由这一变量），
> model=sonnet effort=high，判对错=人工（提两 arm 最终答案 + DB/grep 建可枚举 ground truth +
> 逐项判全/漏/错）。GT 见 `ground-truth-largepolyglot.md` / `ground-truth-trackB.md`，原始
> jsonl 见 `raw/`。

## TL;DR（第五轮的两个硬结论）

1. **轨道A — 大仓上跨进程的效率护城河「蒸发」，不放大。** 在 MAESTRO（1,729 文件、真实
   Python+R 单细胞流水线）上，"Python 流水线通过 Rscript 跑哪些本仓 R 脚本" 这个真实可枚举的
   跨进程题：**正确性平手**（with 2 full + 1 过度包含 / without 3 full）、**努力/成本也平手**
   （with 11.7 工具 / $0.174 vs without 12.3 工具 / $0.182）。根因：MAESTRO 用的真实世界
   idiom `os.system("Rscript %s/x.R" % RSCRIPT_PATH)`（Python `%s` 旧式格式目录 +
   `resource_filename` 运行时安装目录）**正落在 OmniWeave crossLang 的诚实天花板上**——DB
   实测 **0 条 crossLang 边**，于是 with-arm 的 agent **健康地退回 grep**（3 个 with-run 几乎
   没碰 omniweave）。**这与同语言反向查询「赢随规模放大」（round3）相反**：跨进程的赢是
   小仓静态链（quarTeT）现象，不随仓库规模放大。**without-arm 也没有 token 爆炸**（链浅、脚本
   名可 grep），证伪了「大仓 without 必爆炸」的乐观假设。
2. **轨道B — 查询类型路由把「可去除的形态税」去除、保住所有赢（针对性帕累托改进）。** 落地 20 行
   server-instructions 决策树（纯单点元数据→`search`、反向/传递/跨边界→`callers`/`impact`/`explore`、
   理解区域→`explore`）。实测：**纯单点签名题形态税干净消除**（Q2 explore+read 138k→search 92.7k，
   追平 grep 90k）、**反向题 `callers` 赢零退化**（Q3 93k 不变）；**复合单点题（Q1 要构造函数 body）与
   小仓多步跨进程（Q5）路由不可改善——agent find-then-read 习惯 + 固定 MCP 附着开销（~34k）主导，
   4 版路由迭代均如此，诚实记为边界。** vitest 1490 + 25 eval 门禁 + tsc 全绿、零回归（逐版实跑）。

---

## 轨道 A —— 跨进程在「大仓」上复测

### A.0 选仓：严格的「看真实」搜索（15 仓实测，非凭推断）

详见 `ground-truth-largepolyglot.md §0`。**测了 15 个候选仓**（bcbio 606 / galaxy 8,155 /
nipype 1,870 / SU2 2,553 / cgat 1,813 / scipion 394 / MAESTRO 1,729 / trinity 730 / vep
516 / ganga 1,196 / vscode 11,538 / pybuilder 1,045 / mesos 2,295 / ansible 5,765 + 搜索
浮现的若干），每个数字都是真命令（treeless `git ls-files` 测大小、全克隆 grep 测链）。

**决定性发现（饱和相关，如实记）**：**OmniWeave 赢的那种「干净的静态多跳兄弟脚本跨进程链」
（quarTeT 式）在 ≥1,000 文件仓里不自然出现。** 大型成熟仓内部调用走 **import**，subprocess
只留给**外部二进制**、且以**运行时动态构建的命令串**发起（cgat `os.system(statement)` /
ganga `subprocess.run(f'cmt {command}')` / galaxy `shell=True`）或**运行时解析的路径**
（ansible 模块）——**这些对 grep 和 OmniWeave 都是诚实天花板**（谁都跟不了运行时才定的串）。
静态兄弟脚本 idiom 集中在**中小 CLI 套件**（≤300 文件），少数大型基因组编排器是 **Perl**
（trinity 413pl / vep 82pl），其 caller OmniWeave 不索引。**MAESTRO** 是唯一同时满足
「≥1,000 文件 + 真实 Python→R 跨语言 subprocess + 可枚举」的仓——选它。

### A.1 题与可枚举 ground truth

**题**："列出本仓中 Python 流水线代码通过 `Rscript` 作为 subprocess 执行的每个 R 脚本，给出
启动它的 Python file:line；排除仅被 source/library 加载的、和运行时生成的临时脚本；并说明这些
R 脚本本身是否再起 subprocess（第 2 跳）。"

**正确答案 = 恰好 2 个脚本**（grep + 读每个 os.system/subprocess 点 + 读 R/ 目录核验）：
1. `R/scRNAseq_qc_filtering.R` ← `scRNA_QC.py:150` (`os.system("Rscript %s/scRNAseq_qc_filtering.R" % RSCRIPT_PATH)`)
2. `R/scATACseq_qc_filtering.R` ← `scATAC_QC.py:139`（同款）

**边界（不可计入）**：`scRNA_AnalysisPipeline.py:236 "Rscript %s"%rscript` 是
`GenerateRscript()` 运行时写的临时脚本；`utils/unused/scATAC_plot_Frip.py:61` 是死代码；
其余 5 个 R 文件是被 source 的子脚本；`os.system("bedtools …")` 是外部二进制。**1 跳——R 脚本
不再起 subprocess。**

### A.2 三臂结果（with×3 / without×3 + LSP 范畴探针）

| run | arm | 工具数 | omniweave 实际用量 | turns | cost | 正确性 |
|---|---|---|---|---|---|---|
| with-r1 | OmniWeave | 14 | **0**（全 Bash/Read） | 15 | $0.212 | ✓ full |
| with-r2 | OmniWeave | 11 | 1（仅 ToolSearch 门控） | 12 | $0.173 | ⚠ +1 过度包含（死代码 scATACseq_qc.R） |
| with-r3 | OmniWeave | 10 | **0** | 11 | $0.136 | ✓ full |
| without-r1 | grep | 13 | — | 14 | $0.252 | ✓ full |
| without-r2 | grep | 11 | — | 12 | $0.128 | ✓ full |
| without-r3 | grep | 13 | — | 14 | $0.166 | ✓ full |
| **均值** | with | **11.7** | **≈0** | | **$0.174** | 2 full + 1 partial |
| | without | **12.3** | — | | **$0.182** | 3 full |

**LSP arm（范畴探针，确定性，无需 3 run）**：
- `findReferences` on `scRNAseq_qc_filtering.R` → **`No LSP server available for file type: .R`**（范畴失明，无 R server）。
- `incomingCalls` on `scRNA_QC.py:150`（os.system 行）→ **`No call hierarchy item found`**（串无符号、跨边界零信息）。
- bonus：pyright 诊断 `Import "MAESTRO.scRNA_utility" could not be resolved`（零配置失明，复现 round4 P3）。

### A.3 决定性回答

> **「大仓上跨进程正确性是否拉开 + 努力/token 省多少？」答：正确性平手、努力/token 不省
> （with 11.7 vs without 12.3 工具，统计上平手；cost 平手）。** OmniWeave 在 MAESTRO 的真实
> `Rscript %s/x.R` idiom 上命中诚实天花板（0 crossLang 边），with-arm 的 agent 健康地退回 grep
> → 与 without-arm 同构。**跨进程的效率护城河是小仓静态链（quarTeT，round4 省 ~20%）现象，
> 在大仓真实 idiom 上蒸发，不随规模放大。** 这是对「跨进程赢随规模放大」假设的诚实证伪，
> 也是对 round4 价值曲线「档④×大仓」格的诚实填值（见 `value-curve-v2.md`）。
> **诚实记录的天花板（不修，§0.17 教训：不在马拉松尾巴赶脆弱子系统）**：`%s/` Python 格式
> 占位符目录 + `resource_filename` 运行时安装目录需要 dataflow 才能解析，超出静态启发式；
> 加 unique-basename 回退会松动 fileExists 精度门，风险大于收益、且无第二个证据驱动的 testbed。

---

## 轨道 B —— 查询类型路由（消除单点形态税）

### B.0 路由设计（纯提示层，§1.5 合规，零新子系统）

落点 = `src/mcp/server-instructions.ts` 顶部新增「**Match the tool to the query shape**」决策树
（最 salient，agent 先分类）+ 把原 explore-PRIMARY 项从「almost any question」收窄到「理解区域」：
- **单点题** → 只需定位/签名 `omniweave_search`；需 body（构造函数/源码）`omniweave_node`（单调用返
  location+source，**不 chain search→node**）；**绝不为单符号开 explore**（bag 比一个符号贵）。
- **反向/传递/blast/跨边界** → `callers`/`impact`/`explore`（图的甜点区）。
- **理解区域** → ONE `explore`。

回归门禁（路由 build）：**vitest 1490 passed | 2 skipped、tsc 干净、25 eval 门禁全过**
（capstone 10 / polyglot-subprocess 9 / deseq2 2 / workflow 4，逐一实跑）、**0 回归**。
（路由只改 server-instructions，不碰 extraction/resolution，eval 门禁本就不受影响，仍实跑确认。）

### B.1 before 基线（当前 build，无路由）—— 形态税的真实形状（5 题 × with/without × 3，cost 均值）

| Q | 类型 | 仓 | with 工具/cost | without 工具/cost | 形态税? |
|---|---|---|---|---|---|
| Q1 | 单点(TS, HTTPError ctor) | ky | explore×1 → **$0.072 / 95k tok** | grep+read → $0.056 / 90k | **有**（with 用 explore） |
| Q2 | 单点(R, nbinomWaldTest sig) | DESeq2 | explore+read → **$0.117 / 138k tok** | grep+read → $0.058 / 90k | **有**（with explore+read 2× tok） |
| Q3 | 反向(iri_to_uri 17 callers) | django | **callers×1 → $0.072** | grep loop 2–11 工具 / $0.093 | 无（with **赢**） |
| Q4 | 传递(escape_uri_path) | django | impact+callers+explore 4–5 工具 / $0.20 | grep 2–8 工具 / $0.11 | 部分（bounded 题 with over-explore，方差大） |
| Q5 | 跨进程(quartet am) | quarTeT | explore×3 → $0.24 / 252k tok | grep 4–7 工具 / $0.16 | **有**（小仓 explore 3× = round4 小仓税复现） |

**形态税的真实机制（before 实证）**：在 **单点题（Q1/Q2）+ 小仓跨进程（Q5）** 上，with-arm 习惯性
reach for `omniweave_explore`（返回「related sources 的 bag」），当答案只是一个符号/一条签名时，explore
比 `search`/`node` 单调用费 token（Q2 138k vs 92k、Q5 252k vs grep 143k）。**反向题（Q3）with 用
`callers` 1 调用是干净赢、不该动。** 这就是路由要做的：单点→精简工具、反向→保持图工具。

### B.2 before/after 终值（token 是可靠信号；cost 缓存敏感仅作参考）

> **路由迭代了 4 版（v1→v4），每版重跑单点题实测**——这本身是「看真实」：v1/v2 把「需 body 的
> 复合单点题」（Q1 要构造函数）引向 search，agent 遂 **search→node 链**（反而更费）。v3/v4 改为
> **软提示**（纯元数据→search、source→node/explore 任一单调用、不 forbid explore）。**4 版一致测定：
> Q1（复合「where + 构造函数 body」）agent 稳定做 search+read ~2 round-trip，与路由措辞无关**——这是
> agent 的 find-then-read 习惯，prompt 层不可控。终版 = v4（最干净、最不误导）。单点 bullet 之外的
> Q3/Q4/Q5 路由文本各版字节相同，其 after-v1 数据通用。

| Q | 类型 | before with (tok) | **after-v4 with (tok)** | without (tok) | 路由效果 |
|---|---|---|---|---|---|
| Q1 | 单点·复合(TS, where+ctor) | explore **95k** | search+read/node **124–157k** | grep+read 90k | agent find-then-read 2跳；固定 MCP 开销主导；无干净改善 |
| Q2 | 单点·纯元数据(R, signature) | explore+read **138k** | **search 92.7k** | grep+read 90k | **✓ 形态税消除**（92.7k ≈ without 90k，−33% vs before） |
| Q3 | 反向(django 17 callers) | callers **93k** | callers **93k** | grep loop | **✓ win 保持**（callers 1 调用不退） |
| Q4 | 传递(django bounded) | impact+callers 145–159k | callers-loop/impact（方差） | grep 70–189k | bounded 题方差主导，无干净效果 |
| Q5 | 跨进程(quarTeT 小仓) | explore×3 **252k** | node×5 **284k** | grep 143k | 小仓多步题，with>without（round4 小仓税）不被路由消除 |

**正确性**：所有题、所有版本、两臂 — 答案全部正确（Q1 ctor / Q2 13参签名 / Q3 callers / Q4 4方法 /
Q5 2脚本，逐一核对 GT）。路由只改**用哪个工具**，不破正确性。

### B.3 轨道B 决定性回答（诚实，非 cherry-pick）

> **形态税是「真实但小、且形状相关」的**，路由的价值是**把可去掉的那部分去掉**：
> 1. **纯单点元数据题（Q2）：变量形态税 = explore-过度（要签名却开 explore 返回 bag），路由 →
>    `search` 单调用干净消除（138k→92.7k，追平 grep 的 90k）。这正是 round1「+44%」形态税的本体。** ✓
> 2. **反向题（Q3）：`callers` 1 调用的赢被完整保持，零退化。** ✓
> 3. **复合单点题（Q1）：固定 MCP 附着开销（~34k：server-instructions + 工具 schema + ToolSearch 门控）
>    + agent find-then-read 习惯（search+read 2跳）主导——4 版路由均不可消除。诚实边界，非路由缺陷。**
> 4. **小仓多步跨进程（Q5）：with>without（round4 小仓税）是「小仓 grep 能全读」的固有现象，
>    路由不消除（多步题无单一精简工具）。诚实边界。**
>
> **净效果 = 帕累托性的「针对性改进」**：在形态税**可去除**处（纯单点元数据 Q2）去除之、追平 grep；
> 在 OmniWeave **本就赢**处（反向 Q3）零退化。在 agent 行为/固定开销主导处（复合单点 Q1、小仓多步 Q5）
> 如实标为诚实边界——**不假装路由能消除固定 MCP 税或 agent 的 find-then-read 习惯**。
> 落地形态 = **20 行 server-instructions 决策树**（`routing-server-instructions.diff`），零新子系统、
> 零回归（vitest 1490 + 25 eval 门禁 + tsc 全绿，逐版实跑）。
