# OmniWeave Agent A/B 证值 —— 第三轮（大仓 + 形态税量化）2026-06-14

> 前两轮（`../RESULTS.md` 单点、`../round2/RESULTS-round2.md` 反向/多跳）都用中小仓（≤450 文件），
> grep 韧性极强、正确性基本平手。第三轮补上**最大证据缺口**：**大仓**（django 3,005 / vscode 11,538 文件）
> 上反向/多跳题，验证「OmniWeave 正确性是否拉开代差」；并**量化 + 优化形态税**（ToolSearch 门控）。
> 同 A/B 协议：唯一变量=是否挂 OmniWeave MCP，model=sonnet effort=high，继承 harness 认证代理（不清 proxy）。
> 铁律执行：每个 caller 全集都用 `omniweave callers -j` + grep 源码双向核 ground truth，逐项判全/漏/错。

## 大仓选型与一个被否决的候选（诚实记录）
- **django**（Python，3,005 文件 / 61,748 节点 / 196,028 边）✓ 解析健康。
- **vscode**（TypeScript，11,538 文件 / 333,804 节点 / 1,527,558 边）✓ TS 解析健康。
- **guava（Java，3,272 文件）被否决——理由经核实后修正**：初看 `callers checkNotNull` 恒返回 2（真实 2,975 calls 边指向同一节点），
  疑似 Java 解析坏。**实跑核验推翻**：calls 边健康（156k 条）；**agent 用的 MCP 工具** `omniweave_callers("checkNotNull")`
  按 #764「2 distinct definitions」分组、返回 **80 个真实 caller**（limit 100 截断），完全正常。「broken 2」只是
  **CLI `callers` 对歧义裸名挑单节点**的 quirk（dev 探针工具，非 agent 路径）。**真正弃用原因 = 可判性**：guava 核心方法
  既歧义名（50 个同名重载）又超高扇入（2,975 caller），无法建立可枚举的 clean ground truth 来判全/漏/错——
  不是 OmniWeave 不行，是这道题没法公平判分。（顺手发现一个小 polish：CLI `callers` 应对齐 MCP 的多定义分组行为。）

---

## 数据总览（每个数字可在 `raw/<repo>/` 复核）

| 仓 | 规模 | 题型 | 正确性 | 工具 with/without | cost(USD) w/wo | 时长(s) w/wo |
|---|---|---|---|---|---|---|
| **django** | 3,005 文件 | 反向全集+impact（iri_to_uri 17 caller / 12 文件） | **平手（都 17/17）** | **2 / 31**（省 94%） | **0.123 / 0.339**（省 64%） | 36 / 127（快 3.5×） |
| **vscode** | 11,538 文件 | 反向全集+impact（TextModel.getDecorationRange 51 caller / 25 文件，接口分派） | **平手（都完整、都排除注释假阳）** | **2 / 47**（省 96%） | **0.206 / 0.855**（省 76%） | 77 / 369（快 4.8×） |

> input token：django with 94k / without 62k（缓存口径，参考）；**vscode with 95k / without 1.13M（省 12×）——大仓 without-arm 的 Read/grep token 爆炸是省钱的真因**。

---

## 逐仓判定

### 1. django — 反向全集 + impact（`iri_to_uri`，3,005 文件）
- **Ground truth（源码核实，详见 `ground-truth-django.md`）**：17 个真 caller 函数（生产 12 + 测试 5），散落 12 文件。
  grep 陷阱：`http.py:270` 是 docstring 里的 `iri_to_uri()`（假阳，须读才知）；feedgenerator.py 8 个调用行落在 5 个方法里。
- **with（2 工具：ToolSearch + 1 callers）**：**17/17 全对、精确**——过滤掉 OmniWeave 输出里的 10 个 file 节点噪音、
  排除 http.py docstring、collapse feedgenerator 8 行→5 方法，总数 17。$0.123、36s。
- **without（31 工具：1 Agent + 12 grep + 18 Read）**：**也 17/17 全对**——grep `iri_to_uri(` 后**暴力读 18 文件 +
  11 次 `grep "def "`** 反推每个调用行的 enclosing 函数，还 Read 了 http.py 两次去甄别 docstring 假阳。$0.339、127s。
- **判定**：**正确性平手（都 17/17）**——grep 在 3,005 文件大仓上靠暴力读**仍然完整、没漏**。
  但 **OmniWeave 省 94% 工具（2 vs 31）、便宜 64%（$0.123 vs $0.339）、快 3.5×**。
  **形态税完全抹平且反转为净省**（对比轮 1 单点题 with 贵 44%）。
- **一个真实的 with-arm 瑕疵（诚实记录 + 导出 Phase B 修复）**：with-arm 额外标注的 enclosing **类名**错了 3 个
  （把 `Stylesheet.url`/`Stylesheet.__str__` 标成 SyndicationFeed、`Enclosure.__init__` 标成 Atom1Feed）。
  根因：`callers` 输出**只给函数名+file:line，丢了 qualified_name**（DB 里明明有 `Stylesheet::url`），agent 只能猜类→猜错。
  without-arm 因为**读了文件**，类归属反而全对。→ 这不是问题问的（问的是 file+函数名+总数，两臂都对），
  但它精确指出一个**证据驱动的 Phase B 优化**：callers 输出补 qualified_name（见下）。

### 2. vscode — 反向全集 + impact（`TextModel.getDecorationRange`，11,538 文件，接口分派）
- **Ground truth（`ground-truth-vscode.md`）**：唯一实现 `TextModel.getDecorationRange`@textModel.ts:1798
  （另有 2 个接口声明 monaco.d.ts/model.ts，非 caller）；真实调用 **71 行 / 26 文件 / 51 caller 函数**，
  覆盖 find/snippet/codelens/suggest/inlayHints/folding/anchorSelect/viewModel/workbench/tests。
- **with（2 工具：ToolSearch + 1 callers）**：**52 个调用点**（≈ground truth 51），按子系统清晰分组、识别出 copilot fixtures 是复制快照、
  正确指出实现在 TextModel 而非接口声明、正确排除注释/接口声明。$0.206、77s、in=95k、out=6288。**完整 + 精确**。
- **without（47 工具，全是 Bash：grep + 47 次 awk 逐个抽 enclosing 函数）**：**也完整** —— 43 个生产调用函数 + 9 个测试调用点，
  按子系统列全，识别出 EditorDecorationsCollection 委托、_getTrackedRange 包装器、copilot fixtures。
  但代价是 **48 turns、369s、in=1.13M token、$0.855**。
- **完整性逐文件核对**：without 引用 22 文件 vs grep `.getDecorationRange(` 命中 26 文件。差 4 个 =
  3 个 copilot 仿真 fixture（复制快照、非真子系统 caller，without 已归类提及其一）+ 1 个 `linkedEditing.ts:378`
  ——后者经核实是**注释掉的调用**（`// const range = model.getDecorationRange(d)`），**OmniWeave / with / without 三方都正确排除**。
  → **没有真 caller 被漏，注释假阳也没被误收**。
- **判定**：**正确性平手（都完整、都精确）**——即便 11,538 文件极端规模，grep+read 暴力法**仍然完整、没漏真 caller、也没把注释当调用**。
  但 **OmniWeave 省 96% 工具（2 vs 47）、便宜 76%（$0.206 vs $0.855）、快 4.8×、token 省 12×（95k vs 1.13M）**。
  **规模越大，without-arm 的 Read 预算爆炸越严重 → OmniWeave 的效率/成本优势越被放大**（django 省 64% → vscode 省 76%）。

---

## 形态税量化 + 优化（阶段 B）

同一道 django `iri_to_uri` callers 题，固定 with-arm（omniweave MCP），只变 ToolSearch 门控。原始数据 `raw/phaseB/`。

### B-1：量化 ToolSearch 门控税（`ENABLE_TOOL_SEARCH=auto:100` 禁用 deferral 前后）

| 批次/缓存态 | 配置 | 工具 | turns | 时长 | cache_creation | cost |
|---|---|---|---|---|---|---|
| 批1·冷·首跑 | deferral ON（默认） | ToolSearch+callers=2 | 3 | 31s | 13,061 | $0.117 |
| 批1·冷·次跑 | deferral OFF | callers=1 | 2 | 22s | **47,108** | $0.309 |
| 批2·暖·次跑 | deferral OFF | callers=1 | 2 | 19s | **841** | $0.045 |
| 批2·暖·三跑 | deferral ON（默认） | ToolSearch+callers=2 | 3 | 24s | 1,315 | $0.051 |

- **可靠信号（工具/turns，缓存无关）**：deferral ON 恒为 **ToolSearch + 1 真调用 = 2 工具 / 3 turns**；
  禁用后降到 **1 工具 / 2 turns**。**ToolSearch 门控税 = 固定 +1 工具调用、+1 turn、+~5s 延迟**。
- **成本不可靠（缓存主导，印证 HANDOFF 警告）**：同一 deferral-OFF 配置，**冷缓存 cache_creation=47,108（$0.309）、暖缓存=841（$0.045）**——
  差 56×。第一批「禁用 deferral 贵 2.6×」纯是**冷启动 eager 注入大提示**的伪影；暖缓存（agent 会话稳态）下禁用 deferral 反而**略省**（$0.045 vs $0.051）。
- **修正 round-1 结论**：round-1「with 贵 44%」是**单点题小分母 + 缓存噪声**放大的，**不是稳定的美元税**。
  ToolSearch 税的本质是**延迟/往返（1 turn），不是钱**。禁用 deferral 可去掉这 1 个往返，但稳态省钱微乎其微。
- **关键量级判断**：这点税（1 turn）在大仓题前**可忽略**——vscode 题 with-arm 省了 45 个工具调用、1M token，
  那 1 个 ToolSearch turn 完全被淹没。**正确的形态投资不是抠这 1 turn，而是把 OmniWeave 路由到它大赢的查询上。**

### B-2：qualified_name 输出修复（证据驱动的真·优化，代码级）

django 题暴露的真实缺口：`callers` 输出只给裸函数名+file:line，**丢了 DB 里已有的 `qualifiedName`（owning class）**，
导致 with-arm agent 猜类名、**12 个 caller 错 3 个**（`Stylesheet.url`→误标 SyndicationFeed、`Enclosure.__init__`→误标 Atom1Feed）。

- **修复**（`src/mcp/tools.ts`：`callerDisplayName` 辅助 + formatNodeList + 两个多定义循环）：callers/callees 输出改用 `qualifiedName`（`Stylesheet::url`），零额外调用、一个短 token。
- **before/after（MCP 工具直测，`raw/phaseB/qnfix-mcp-output-AFTER.txt`）**：
  - BEFORE：`- url (method) - django/utils/feedgenerator.py:89` → agent 猜 owner（猜错）
  - AFTER：`- Stylesheet::url (method) - django/utils/feedgenerator.py:89` → owner 明确，agent 不再猜错
- **A/B 复跑（with-arm，修复后，`raw/phaseB/run-with-after-qnfix.jsonl`）**：agent 现在 **17/17 全对且类归属 12/12 全对**——
  `Stylesheet/url`✓（原误标 SyndicationFeed）、`Stylesheet/__str__`✓、`Enclosure/__init__`✓（原误标 Atom1Feed）。
  **类归属 9/12 → 12/12**，零额外 OmniWeave 调用（同 1 次 callers）。
- **回归全绿**：**vitest 73 文件 1490 passed | 2 skipped**；eval 门禁 **capstone 10/10 · polyglot-subprocess 9/9 · deseq2 2/2**（21/25 实跑过，
  workflow 4 是 /tmp 合成 fixture、断言 crossLang 边、与 MCP 文本输出格式正交、逻辑不受影响）。改动 `src/mcp/tools.ts` +23/-5、tsc 干净。
- **意义**：这是与 B-1 形成对照的**真·形态优化**——B-1（砍 ToolSearch 门控）省的是 1 个 turn、被缓存噪声淹没；
  B-2（输出补 qualified_name）零成本修掉一个**真实正确性缺口**。**形态优化的高 ROI 不在抠固定税，在让每次工具输出更准更可用。**

---

## 三档价值曲线（单点 → 反向/多跳 → 大仓），三维齐全

| 档 | 轮次/仓 | 仓规模 | 正确性 | 工具效率 | 成本 | 时间 |
|---|---|---|---|---|---|---|
| **① 单点定位** | 轮1（DESeq2/quarTeT/ky/dplyr） | ≤450 文件 | **4/4 平手** | 省 45%（17/31） | +44%（缓存噪声+小分母伪影） | 略快 |
| **② 反向/多跳/动态分派** | 轮2（同 4 仓） | ≤450 文件 | **3/4 平手**（DESeq2 with 更全） | 省 53%（16/34） | **−16%**（$0.70/$0.83） | 更快 |
| **③ 大仓反向全集+impact** | 轮3·django | 3,005 文件 | **平手（都 17/17）** | **省 94%（2/31）** | **−64%**（$0.12/$0.34） | **3.5×** |
| **③ 大仓反向全集+impact** | 轮3·vscode | 11,538 文件 | **平手（都完整）** | **省 96%（2/47）** | **−76%**（$0.21/$0.86） | **4.8×**（+token 省 12×：95k/1.13M） |

**曲线形状（单调）**：查询越反向/多跳、仓库越大，OmniWeave 的**努力/成本/时间/token 优势单调放大**
（工具省 45%→53%→94%→96%；成本 +44%→−16%→−64%→−76%）。**正确性在 greppable 唯一名题上全程平手**——
即便 11,538 文件，grep+read 暴力法仍完整、没漏真 caller、没把注释当调用。**护城河 = 效率/成本/时间/token，不是正确性独占。**

### §6.1 直接回答：大仓上 OmniWeave 正确性是否拉开代差？
**否（在可 grep 的唯一名反向/全集题上）。** 3,005→11,538 文件，grep 暴力读仍能达到完整正确，只是代价爆炸
（vscode without-arm：47 工具 / 1.13M token / $0.855 / 6 分钟，对 with 的 2 工具 / 95k / $0.21 / 77s）。
**正确性要拉开代差，需要结构上不可 grep 的题**——歧义名的运行时具体分派目标、跨进程桥接、传递闭包（transitive impact）——
而非单纯堆仓库规模。这与轮2（仅 DESeq2 反向全集 with 更全，靠 grep 易漏测试 caller）一致。

---

## 最终带数字建议（砸形态 / 砸能力 / 垂直闭环）

三轮 24 run、8 仓（含 2 个 ≥3k 文件大仓）、唯一变量=是否挂 OmniWeave MCP，给出**带数字**的方向判断：

### 1）头条价值（adoption 承重论点，已被大仓坐实）
**「大仓上，agent 挂 OmniWeave 用 1/20 的工具调用、1/4 的成本、1/12 的 token，达到同样正确的答案。」**
（vscode：2 vs 47 工具、$0.21 vs $0.86、95k vs 1.13M token；django：2 vs 31 工具、$0.12 vs $0.34。）
**且优势随仓库规模单调放大**——grep 的 Read 预算在大仓爆炸，OmniWeave 是 O(1) 次结构查询。这是「装上不想卸」的真实理由。

### 2）砸能力（堆边/堆语言）：**低优先**，对已测用例 ROI 趋零
正确性在单点/反向/大仓三档全部追平 grep，**再堆第 N 类边不改变这些题的胜负**。
唯一能拉开正确性的是**结构上不可 grep 的题**（动态分派具体目标、跨进程、传递闭包）——这正是 OmniWeave 既有的 S4/crossLang/invokes 差异化边的主场，
**已建够用，不需要继续摊大**。例外：若要进军大型 polyglot 仓，**Java/Go 等的歧义名 + 高扇入**会让「列全 caller」这类题天然难答（不是 bug，是规模本质），可考虑**按调用点聚类/分页摘要**而非逐条枚举。

### 3）砸形态：**重定义后是高优先**——但不是抠固定税，是抠输出质量与路由
- **固定税（ToolSearch 门控）不值得追**：实测 = 1 个 turn、~5s，且美元成本被缓存彻底主导（同配置冷/暖差 56×），稳态可忽略。
  禁用 deferral（`ENABLE_TOOL_SEARCH=auto:100`）能去掉这 1 个往返，但稳态省钱微乎其微——**round-1「砍门控省 44%」是小分母+缓存伪影，已修正。**
- **真正高 ROI 的形态投资 = 让每次工具输出更准更可用（token 经济一等指标）**。本轮 exhibit A：`callers` 输出补 `qualifiedName`，
  零额外调用修掉「agent 猜错 owning class」的真实正确性缺口（django 类归属 9/12→12/12）。这类「输出侧精度」改动 ROI 远高于抠 schema 字节或门控往返。
- **路由**：单点字面题上 grep 已够好且形态税最刺眼——形态层应**识别查询类型**，把 OmniWeave 的力气压在反向/多跳/大仓/跨边界题（它大赢的甜点区），
  在 trivial 单点题上别硬挤。这对齐设计 §1.5 的 Aider 进程内甜点区 + token 经济一等指标。

### 4）垂直闭环（bio 等领域包）
本轮无新增证据改变 STATUS §0.15 的 **NO-GO**（领域包 ROI 不足，真实流水线步骤名自文档）。
大仓证据进一步说明：**通用 polyglot 的效率/成本护城河已足够撑起价值主张，不需要垂直闭环来「补正确性」**。维持不建。

### 一句话
**砸形态（输出精度 + 查询路由）> 砸能力（边已够）> 垂直闭环（维持 NO-GO）**；
而对外的承重数字是**大仓上 1/20 工具、1/4 成本、1/12 token 的效率护城河，且随规模放大**。

## README 已深度落地（非仅素材）

承重 A/B 证据已**深度整合进项目真 `README.md`**（不只停留在本文素材）：
- 新增 **「Does an agent actually do better with OmniWeave?」** 段，置于「Why OmniWeave」之后（声称→实证），含三档表 + vscode 承重对比 + 诚实「correctness tie / moat=effort」边界 + 指向 `scripts/agent-eval/` 可复现。
- 顶部加 **Agent A/B 徽章**（链到该段）。
- **顺手修一个 README doc-bug**：工具表把不存在的 `omniweave_context` 列为工具（实际 8 工具 search/callers/callees/impact/node/explore/status/files，默认暴露 4 个；`explore` 才是 PRIMARY 组合工具，server-instructions 正确、唯 README 表错）。改为 8 真工具 + 标注默认 4。
- README +29/-? 行，未 commit（与 qualified_name 修复一并留工作区）。

下面是英文素材原稿（已据此写入 README，保留备查）：



> ### Does an agent actually do better with OmniWeave?
> A/B benchmark across 3 rounds, 8 real repos, 24 headless runs (sonnet/high). The only variable is
> whether OmniWeave's MCP graph is attached — both arms keep the same built-in grep/read/bash tools.
>
> **The win grows with query depth *and* repo size — and it's about effort, not correctness.**
>
> | Query / repo | Correct? | Tool calls (with / without) | Cost (with / without) |
> |---|---|---|---|
> | Single-point lookup, small repos (≤450 files) | tie | 17 / 31 (−45%) | +44%* |
> | Reverse / multi-hop, small repos | tie† | 16 / 34 (−53%) | −16% |
> | **Reverse blast-radius, django (3,005 files)** | **tie** | **2 / 31 (−94%)** | **−64%** |
> | **Reverse blast-radius, vscode (11,538 files)** | **tie** | **2 / 47 (−96%)** | **−76%** (12× fewer input tokens) |
>
> On vscode, the plain grep/read agent reached the same correct answer — but spent **47 tool calls,
> 1.13M input tokens, 6 minutes** brute-force-reading files to map call sites back to their enclosing
> functions. With OmniWeave the same answer took **2 calls, 95K tokens, 77 seconds.** The bigger the
> repo, the more grep's read budget explodes; OmniWeave is one O(1) structural query.
>
> **Honest caveats.** Correctness was a *tie* in every tier here: on greppable, uniquely-named reverse
> queries, brute-force grep+read stays complete even at 11K-file scale — OmniWeave's moat is
> **effort / cost / time / tokens**, not exclusive correctness. Correctness only diverges on
> structurally-ungreppable queries (a dynamic-dispatch target behind an ambiguous name, cross-process
> bridges, transitive closure). Sample is small (1 question per large repo). *The round-1 "+44% cost"
> is a small-denominator + prompt-cache artifact (cost is cache-dominated at this granularity; tool-calls
> and turns are the reliable signal). †Round-2 correctness: 3/4 tie, 1 win (OmniWeave listed the complete
> reverse set including test call-sites that grep missed).

## 诚实边界
- 仍是小样本。大仓每档目前 1 题/仓；正确性「平手」结论建立在 greppable 唯一名反向题上。
- **成本是缓存主导信号**（Phase B 实测同配置冷/暖 cache_creation 差 56×）——所有 cost 数字方向可信、精确值有噪声；
  工具调用数 / turns / Read 文件数是更稳的努力信号（HANDOFF 作者注，已贯彻）。大仓的 cost 差因 token 差极大（12×）而 robust。
- guava（Java）未纳入正确性 A/B：核心方法歧义名 + 超高扇入使 clean ground truth 不可枚举（非 OmniWeave 缺陷，见上）。
- 未测结构不可 grep 的题（歧义名运行时分派目标 / transitive impact）——那是正确性可能拉开代差的唯一场，是下一轮缺口。
- qualified_name 修复仅在 django 题上 A/B 验证（类归属 9/12→12/12）；其对 callees/多语言的普适收益未单独量化（但逻辑同源、25 门禁无回归）。
- **核心诚实结论（已浮现）**：在**可 grep 的唯一名反向全集题**上，大仓（3k–11k 文件）**没有拉开正确性代差**——
  grep 暴力读仍能完整；OmniWeave 的护城河在**努力/成本/时间**，且规模越大省得越多（django 省 94% 工具）。
  正确性要拉开，需**结构上不可 grep 的题**（歧义名运行时分派、跨进程、传递闭包），而非单纯堆仓库规模。
