# OmniWeave Agent A/B 证值 —— 第四轮「全球最好」(2026-06-14)

> 前三轮（`../RESULTS.md` 单点 / `../round2` 反向多跳 / `../round3` 大仓+形态税）结论：**greppable 题正确性全档平手，护城河=效率/成本/token 随规模放大**。第四轮攻最后两个缺口：
> ① **正确性是否在「结构不可 grep」的题上拉开代差**（轨道1，用户点名最高优先）；② **赢真竞品**（LSP / Aider，轨道2）；并补 ③ 统计严谨（≥3 run/格 + 跨模型，轨道3）④ 形态产品化落地（轨道4）。
> 协议同前：唯一变量=是否挂 OmniWeave MCP，model=sonnet effort=high（轨道3 另加 haiku），继承 harness 认证代理。判对错=人工（提两 arm 最终答案 + `omniweave`/grep/DB 建可枚举 ground truth + 逐项判全/漏/错）。ground truth 见 `ground-truth-round4.md`，原始 jsonl 见 `raw/`。

## TL;DR（第四轮的三个硬结论）

1. **正确性分歧假设被证伪。** 在 4 类结构不可 grep 的题（歧义运行时分派陷阱 / 浅+深传递闭包 / 跨进程多跳）上，**sonnet 与 haiku 两个模型、每题 3+3 run，正确性全部平手**——一个有能力的 agent 会**读源码并自我核验**，即便面对刻意构造的虚分派陷阱、4 跳传递闭包、跨进程递归，grep+read 仍达到正确答案。**OmniWeave 在正确性上不独占**——这与设计哲学「只抽声明不抽分派、诚实天花板」自洽（连 OmniWeave 自己的 `calls` 边也会指向陷阱里的基类声明）。
2. **真竞品 head-to-head：OmniWeave 平 LSP 的同语言导航、赢 LSP 的零配置/跨语言/跨进程。** TS 上 `typescript-language-server` 的 incomingCalls/goToImplementation 与 OmniWeave 同样 1 调用完整（**LSP 是同侪不是受害者**）；但 Python 零配置 checkout 上 pyright **完全失明**（17 caller→0），R-S4/跨进程/跨语言 LSP **范畴性**够不着。Aider repo-map 是排序的 context 列表、**无任何可走的边**，结构上答不了导航/分派/跨进程题。
3. **护城河 = 努力/成本/token，对弱模型更宽，且已落地一项形态优化。** guava 分派题：with-arm 恒 2 工具[2-2]、without 7.7(sonnet)→**13(haiku)**——**模型越弱，没有结构时 flail 越狠，OmniWeave 省得越多**。轨道4 实测「深传递题上 impact 被默认砍掉 → agent 退化成 ~20 次递归 callers」，**重新暴露 impact + 加截断信号**后 24→16 工具，**vitest 1490/1490 + 25 eval 门禁全绿、零回归**。

---

## 轨道 1 —— 结构不可 grep 的题：正确性是否拉开代差？（用户点名最高优先）

设计四类「grep 结构上够不着」的公平大仓题，建可枚举 ground truth，A/B 判对错。**假设：这里 OmniWeave 正确性终于拉开。实测：证伪。**

### (a) 歧义名运行时具体分派目标 —— guava `ImmutableSortedMap.reverseOrder()`（3,272 文件）
- **题**：`reverseOrder()` 返回 `new Builder<>(Ordering.<K>natural().reverse())`，运行时存进 Builder 的 `Comparator` 是哪个**具体非抽象** Ordering 子类？
- **正确答案 `ReverseNaturalOrdering`**；**陷阱答案 `ReverseOrdering`**（基类 `Ordering.reverse()` @415 返回它，但 `natural()`→`NaturalOrdering.INSTANCE`，其 `reverse()` override @70 返回 `ReverseNaturalOrdering.INSTANCE`）。
- **OmniWeave 自身也踩陷阱**：`node reverseOrder` 的 `Calls → reverse (Ordering.java:415)`——它把 `.reverse()` 解析到**基类声明**（陷阱目标），不指向 override。这是「只抽声明不抽分派」的诚实天花板，**OmniWeave 的边在这里是潜在误导**。
- **判定（sonnet 3+3 / haiku 3+3 = 12 run）**：**12/12 全部答对 `ReverseNaturalOrdering`**——两臂、两模型都没被陷阱骗到（grep 臂读 `natural()`→NaturalOrdering→其 override；with 臂没盲信 OmniWeave 的误导边，自行导航核验，印证 round2「agent 不盲信图」健康信号）。
- **效率（轨道3 方差）**：with **2 [2-2] 工具**（零方差）；without sonnet **7.7 [7-9]**、haiku **13 [12-14]**。**正确性平手，OmniWeave 省 74%(sonnet)/79%(haiku) 工具**。

### (b) 传递闭包 impact —— django（3,005 文件）
**浅链**（`escape_uri_path`，闭包 4 方法 / 3 跳，限 request.py）：**6/6 平手**（两臂都找到最深的 `__repr__`）。**without 反而更高效**（2 [2-2] 工具 vs with 6.3 [3-11]）——浅而干净的题 grep 无敌，OmniWeave 过度探索。
**深链**（`get_srid_info`，闭包 27 节点 / 4 跳 / 7 文件 / 5 目录，含动态分派的 lookups.py 链）：**平手**——
- with **3/3 完整**（找到 conversion.py 判别子 + scout 预测「两边都漏」的动态分派 lookups 链，**零假阳**）；without **2/3 完整 + 1 退化短跑**（也做了第 3 轮 grep、追到动态分派链）。**scout「grep 漏 conversion.py」预测被证伪。**
- 效率：with **24 [20-27]** vs without **43.7 [35-57]** 工具——OmniWeave 省 ~45%，**但远不及反向题的 70-96%**：因 `impact` 工具被默认砍掉，with-arm 退化成 **18-25 次递归 callers** 手搓闭包。→ **直接催生轨道4 改进**（见下）。

### (c) 跨进程多跳 —— quarTeT（Python polyglot）
- **题**：跑 `quartet.py am` 子命令，哪些**其它仓内 Python 脚本**会被 subprocess 直接/传递执行？
- **正确答案 2 脚本**：`quartet_assemblymapper.py`（直接，`quartet.py:31` f-string subprocess）+ `quartet_teloexplorer.py`（传递，`quartet_assemblymapper.py:44` 深埋 plotting 分支的递归 subprocess）。边界：gapfiller/centrominer 属别的子命令、quartet_util 是 import 非 subprocess。
- **判定（3+3）**：**6/6 全部正确且精确**——连深埋第 44 行的 teloexplorer 递归、import-vs-subprocess 区分、排除无关脚本，**两臂都精确答对**。OmniWeave DB 捕获了全部 5 条 crossLang 边（含 `AssemblyMapper→teloexplorer.py` 递归）；**但外部工具 nucmer/minimap2 零捕获**（`invokes` 仅认 Snakemake wrapper:，不认原始 subprocess）——诚实天花板。
- **效率**：with 6.3 [5-8] vs without 8 [5-11] 工具，但 **with 成本更高**（$0.32 vs $0.24）——**小仓（7 文件）grep 能全读，形态税可见**（印证 round1 单点结论）。

### (d) 回调/注册间接
经核验，OmniWeave 的差异化机制（crossLang/S4/invokes/callers 的 callback-registration 标注）覆盖的「间接」是**注册即调用点**（callers 已标 "via callback registration"）。纯字符串命令分派（vscode command id、Django signal name）OmniWeave **不建模**（非 call 边）——与 (a) 同属「值/字符串决定的运行时分派」诚实天花板。未单独 A/B（归入 (a) 的共享天花板结论）。

### 轨道1 决定性回答
> **「正确性在哪类题拉开代差、拉开多少？」答：在我们能公平构造、可判分的结构不可 grep 题上，正确性「不」拉开——4 类 × 2 模型 × 3+3 run 全部平手。** 根因有二：① 有能力的 agent 会读源码并自我核验，grep+read 韧性极强（连虚分派陷阱、4 跳闭包、跨进程递归都追得到）；② OmniWeave 自身对「运行时具体分派目标」是诚实天花板（routes-to-declaration），不号称解它。**正确性不是 OmniWeave 的护城河；努力/成本/token + 零配置/跨语言（vs LSP）才是。** 这是对用户假设的诚实证伪，比包装一个 cherry-pick 的「独赢」更有价值。

---

## 轨道 2 —— 真竞品 head-to-head（LSP / Aider repo-map）

完整 grounded 探针见 `competitor-capability-matrix.md`。规制 = **fresh checkout 零配置**（harness 实景，四工具都该享）。

| 题型 | grep+read | **OmniWeave** | **LSP** | **Aider repo-map** |
|---|---|---|---|---|
| TS 同语言反向 callers (vscode getDecorationRange) | 完整(47 工具暴力) | 完整(2 工具) | **完整(1 调用, incomingCalls=45)** | ✗ 无 call 边 |
| TS 接口分派 (ITextModel→impl) | 读取可达 | 列候选 | **完整(goToImplementation 1 调用)** | ✗ |
| **Python 零配置反向 callers (django iri_to_uri, 17 caller)** | 完整(暴力) | **完整(2 工具)** | **✗ 失明**(pyright incomingCalls=0 / findReferences=1=仅定义；未装包→跨模块解析崩) | ✗ |
| **跨进程桥 (quarTeT 入口→脚本)** | ~读取可达 | **✓ crossLang 1 调用** | **✗ 范畴性**(无符号跨 subprocess 字符串) | ✗ |
| **R-S4 运行时分派 (DESeq2)** | 读 setMethod 可达 | ✓ 分派图 | **✗ 范畴性**(R-LSP 静态解不了 S4) | ✗ |

**结论**：
- **vs LSP**：**同语言导航平手**（TS 上 LSP 是同侪，1 调用完整——设计 §1.5② 明令「别和 LSP 撞车」，实测印证）；**OmniWeave 赢在 LSP 范畴性/环境性够不着处**——零配置 Python（pyright 需装好的环境，fresh checkout 失明）、跨语言、跨进程、R-S4。
- **vs Aider repo-map**：**范畴性**——repo-map 由构造就是「tree-sitter tags → 引用图 → PageRank → token 预算截断」的**排序文件签名列表**，emit **零可走的边**，是 context 选择启发式不是查询接口，结构上答不了任何 callers/分派/跨进程题。（`pipx install aider-chat` 在本机失败=aider 钉死 numpy==1.24.3 无 py3.13 wheel；该 gap 不依赖运行实例，同 §1.5 对 LSP request-type 的范畴论证。）
- **诚实**：LSP 的零配置失明是「环境形态」差异（agent 真实 venv 里 pyright 会解析），但 fresh-checkout 正是 §1.5「任何 repo 零配置即开即用」在意的规制，且 grep/OmniWeave/Aider 全零配置——公平。

---

## 轨道 3 —— 统计严谨（每题 ≥3 run 报方差 + 跨模型）

| 题(类) | 模型 | with 工具 [范围] | without 工具 [范围] | 正确性 | 成本 with/without |
|---|---|---|---|---|---|
| guava 分派(a) | sonnet | **2 [2-2]** | 7.7 [7-9] | 6/6 平手 | $0.10/$0.14 |
| guava 分派(a) | **haiku** | 2.7 [2-3] | **13 [12-14]** | 6/6 平手 | $0.07/$0.15 |
| quartet 跨进程(c) | sonnet | 6.3 [5-8] | 8 [5-11] | 6/6 平手 | $0.32/$0.24（with 更贵·小仓税） |
| django 浅传递(b) | sonnet | 6.3 [3-11] | **2 [2-2]** | 6/6 平手 | $0.18/$0.16 |
| django 深传递(b) | sonnet | 24 [20-27] | 43.7 [35-57] | 平手 | $0.46/$0.62 |

**轨道3 结论**：① 正确性平手是**稳健**的（3+3 × 2 模型 × 5 题 = 30+ run，无单点侥幸）；② **with-arm 工具数低方差**（guava 恒 2），without 高方差——OmniWeave 给确定性高效路径；③ **跨模型新发现：模型越弱，OmniWeave 的努力护城河绝对值越大**（haiku without 13 工具 vs sonnet 7.7；with 都 ~2-3）——OmniWeave 拯救的是「弱模型在无结构时的 flail」，不是正确性；④ 形态税在小仓/浅题仍可见（quartet/escape：without 更便宜）——**护城河随仓库规模与查询深度放大的曲线不变**。

---

## 轨道 4 —— 形态产品化：把测出的赢落进产品

**证据驱动的缺口**（来自 (b) 深传递）：`get_srid_info` 这类「传递 blast-radius」正是 `omniweave_impact` 一击该解的，但 **impact 不在默认暴露的 4 工具里**（`explore/node/search/callers`，曾因「ZERO recorded runs」被砍）。实测后果：with-arm 退化成 **18-25 次递归 callers** 手搓闭包，OmniWeave 在 (b) 类的效率优势从 70-96% 缩到 ~45%。**「ZERO recorded runs」是自我实现的缺席**（砍了所以没人用）。

**改进（已落地，零回归）**：
1. **重新暴露 `impact`**（默认 5 工具）+ 证据化 rationale（`src/mcp/tools.ts` DEFAULT_MCP_TOOLS）。
2. **impact 截断信号**（`src/types.ts` Subgraph + `src/graph/traversal.ts` getImpactRadius/Recursive + `src/mcp/tools.ts` formatImpact）：闭包深于 `depth` 时附「⚠️ Partial — stopped at depth N; at least M more deeper. Re-run with depth=N+2」。**实测**：impact depth=2→20 符号+「at least 8 more deeper」；depth=5→28 符号、无截断提示（8=28−20 精确）。把**静默截断**变成**可操作信号**（同 qualified_name 哲学：「agent 得猜」→显式）。
3. **server-instructions 路由**：传递 blast-radius → `omniweave_impact`（一调用闭包，按提示加 depth），直接 callers → 直接调用点。
4. **门禁**：`mcp-tool-allowlist.test.ts` 更新到 5 工具默认。

**回归门禁**：**vitest 73 文件 1490 passed | 2 skipped、tsc 干净、25 eval 门禁全绿**（capstone 10 · polyglot-subprocess 9 · deseq2 2 · workflow 4，逐一实跑）。

**前后 A/B（两种题型，皆零正确性损失）**：
- **受控纯集合 blast-radius 题**（同 build、仅 toggle `OMNIWEAVE_MCP_TOOLS` 隔离单一变量；3+3）：
  - **BEFORE（impact 隐藏，4 工具面）**：16 / 21 / 17 工具 = 均 ~18，全靠递归 `callers` 手搓闭包，正确性 **3/3 完整**（含 conversion.py 判别子）。
  - **AFTER（impact 暴露，5 工具面）**：2 / 2 / 2 工具 = **1 个 `omniweave_impact` 调用**（agent 自选 `depth:10` 直取完整闭包，server-instructions 的 depth 引导生效），正确性 **3/3 完整**。
  - **→ ~89% 工具削减、正确性不变**。这是 impact 暴露的 dramatic 收益（纯集合题正是它一击该解的）。
- **同题但要 call chain（`get_srid_info`）**：BEFORE 24 [20-27] → AFTER 用上 impact 但仍辅以 callers 建链（题目要链非集合），降幅适中——印证 impact 收益**因题而异**：纯集合题大降、要链的题适中；截断信号是两者皆受益的 always-on 安全网。

---

## 价值曲线（四档 × 三基线 × 多维）—— 见 `value-curve.md`（轨道5/6 + 验收5 汇总）

## 诚实边界
- 正确性「平手」是 sonnet/high + haiku 下、在**我们能公平可判**的题上的结论；不排除某类我们没想到的题上分歧，但 4 类主流候选 + 30+ run 已是强证据。
- (a) 的「陷阱」由我们刻意构造仍未骗到模型——说明现代模型对虚分派的稳健性高于预期（这本身是发现）。
- impact 改进的 before/after 在 chain-demanding 题上是 ~33%（impact 给集合非链）；纯集合题的 dramatic 收益见受控 A/B。
- Aider 未实跑（装包失败），其 gap 是范畴性论证（与 §1.5 对 LSP 同法），非实例实测。
