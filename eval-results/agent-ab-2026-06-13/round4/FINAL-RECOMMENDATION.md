# OmniWeave —— 终版带数字总建议（验收7，2026-06-14）

> 基于四轮 / ~60 headless A/B run / 8 仓 / 5 语言（R·Python·TS·Java·polyglot）/ 2 模型（sonnet·haiku）/ 3 基线（grep·LSP·Aider）的实测证据。每条建议都带数字、可复核（`eval-results/agent-ab-2026-06-13/`）。

## 一句话

**砸形态（输出精度 + 工具面 + 查询路由）> 砸能力（边已够，正确性全档追平且分歧假设已证伪）> 垂直闭环（维持 NO-GO）。** 对外承重数字：**大仓上 1/20 工具、1/4 成本、1/12 token，且优势随仓库规模与模型变弱而放大**；定位 = **零配置、语言无关、跨进程/跨语言/动态分派的结构层——LSP 的同语言同侪、其盲区的赢家；Aider 给不了的可走边**。

## 1）砸能力（堆边/堆语言）：**最低优先，ROI 趋零**

- **正确性在所有四档全档追平 grep**——单点(4/4)、反向/多跳(3/4)、大仓反向(都完整)、**结构不可 grep(round4: guava 分派陷阱 12/12、quarTeT 跨进程 6/6、django 深传递平手)**。
- **用户「正确性会在结构不可 grep 题上拉开」的假设，已被 round4 决定性证伪**：刻意构造的 Java 虚分派陷阱、4 跳传递闭包、跨进程递归，sonnet 与 haiku 两模型、每题 3+3 run，**正确性全部平手**。根因：① 有能力的 agent 读源码 + 自核验；② OmniWeave 对「运行时具体分派目标」本就是诚实天花板（routes-to-declaration，连它自己的边都指向陷阱基类）。
- **故再堆第 N 类边/第 M 门语言，不会改变任何已测题的胜负。** 广度已饱和（5 语言 × 多题型结论不变）。
- **唯一的能力级改进方向**（低 ROI）：OmniWeave 对自身诚实天花板的**输出标注**——如 `node`/`callees` 对「多 override 候选」标注分派歧义（guava `reverse` 现静默指向基类）。但实测 agent 不被误导（自核验），收益边际。**不投。**

## 2）砸形态：**最高优先——已验证一项、范式已确立**

形态优化分两类，实测 ROI 天差地别：
- **固定税（ToolSearch 门控）不值得抠**：round3 实测 = 1 turn / ~5s，美元被 prompt 缓存主导（冷/暖差 56×），稳态可忽略。
- **输出精度 + 工具面 + 路由 = 高 ROI**（直接放大「努力护城河」这条真护城河）：
  - **范本①（round3）qualified_name**：callers/callees 输出补 owning class，django 类归属 9/12→12/12，零额外调用。
  - **范本②（round4·本轮落地）impact 工具面 + 截断信号**：深传递题上 impact 曾被默认砍掉 → agent 退化成 ~18 次递归 callers。**重新暴露 impact + 加「深于 depth 时附 ⚠️ N more deeper, re-run depth=N+2」截断信号 + server-instructions 路由**后，受控纯集合 blast-radius 题 **~18 → 2 工具（−89%）、正确性不变（3/3 完整）**；vitest 1490/1490 + 25 eval 门禁全绿、零回归。
  - **下一步形态投资（按 ROI 排）**：① **查询类型路由**——单点字面题让 grep（form-tax 最刺眼处，round1/quartet 实测 with 更贵）、反向/多跳/跨边界/大仓题压给 OmniWeave（它大赢的甜点区）；② 继续「每个工具输出的『agent 得猜』缺口」审计（qualified_name + impact-truncation 是范本，找下一个）；③ 进程内/嵌入式甜点区（§1.5，向 Aider 形态靠，token 经济一等指标）。

## 3）垂直闭环（bio 领域包）：**维持 NO-GO**

round4 无新证据改变 STATUS §0.15 结论。通用 polyglot 的效率/成本护城河已足够撑价值主张，**不需要垂直闭环补正确性**（正确性本就全档平手）。真实流水线步骤名 ~100% 自文档 + 现有 crossLang/invokes 已恢复工具 + LLM 自有知识 = EDAM 三表纯冗余。**不建。**

## 4）竞品定位（带数字）

| 对手 | 关系 | 数字证据 |
|---|---|---|
| **grep/read** | 正确性平手、**努力/成本/token 大赢且随规模放大** | 大仓 2 vs 47 工具、95k vs 1.13M token、77s vs 6min（vscode）|
| **LSP** | 同语言导航**同侪**；零配置/跨语言/跨进程/R-S4 **赢** | TS incomingCalls 同样 1 调用完整；Python 零配置 pyright **0/17 caller**（失明）；跨进程/R-S4 范畴失明 |
| **Aider repo-map** | **范畴性赢**（它无可走的边） | repo-map = PageRank 排序 context 列表，答不了任何 callers/分派/跨进程题 |
| **模型能力轴** | 模型越弱护城河越宽 | guava 分派：haiku without **13** 工具 vs with **2.7**；sonnet without 7.7 vs with 2 |

**对外承重定位（一句）**：**「OmniWeave 是给 coding agent 的零配置、语言无关的结构层——在大仓/polyglot 上用 1/20 的工具、1/4 的成本达到同样正确的答案；是 LSP 的同语言同侪、其零配置/跨语言/跨进程盲区的赢家；模型越便宜、仓库越大，越离不开它。」** 不卖「更正确」，卖「同样正确，但更快、更省、零配置、跨边界、对弱模型尤甚」。

## 5）下一步候选（若继续，按价值）

1. **查询类型路由**（形态，最高 ROI）：在 server-instructions 或一个轻路由层，单点字面 → grep、反向/多跳/跨边界 → OmniWeave；前后 A/B 量化 form-tax 在单点题上被消除。
2. **更大 monorepo 极端规模**（性能广度）：llvm/chromium 子集测退化曲线，坐实「O(1) 结构查询 vs grep O(repo) 读预算」的规模上限。
3. **输出精度审计第三例**（形态）：系统过一遍每个工具输出，找下一个「agent 得猜」缺口（trace 的路径置信？explore 的截断？）。
4. **弱模型护城河深挖**（轨道3 延伸）：haiku 实测护城河更宽——若目标用户用便宜模型，这是承重论点，值得专门 A/B 矩阵。
