# OmniWeave —— 终版带数字总建议 v2（round5 更新，2026-06-14）

> 基于五轮 / ~90 headless A/B run / 15+ 仓实测 / 5 语言 / 2 模型 / 3 基线。每条带数字、可复核
> （`eval-results/agent-ab-2026-06-13/`）。本文在 `../round4/FINAL-RECOMMENDATION.md` 上叠 round5 两个新发现。

## 一句话（v2）

**砸形态 > 砸能力 > 垂直闭环 仍成立，但 round5 把两条边界钉死了**：
- **砸能力**：不仅边已够（正确性全档平手），**跨进程的效率赢也被证明是「小仓现象」——大仓上蒸发**
  （MAESTRO 1,729 文件实测平手）。再投「跨进程×大仓能力」= 零 ROI，新增 NO-GO。
- **砸形态**：路由层（prompt routing）**已达其设计天花板**——变量形态税削平（纯单点签名 138k→92k 追平
  grep），但剩下的是**固定 MCP 附着开销（~34k）**，prompt 层 4 版迭代不可降。**下一步形态投资必须换层**：
  降固定层（进程内/嵌入式，§1.5①）或继续输出精度（round3/4 范式），**不是再调 prompt**。

## 1）砸能力（堆边/堆语言/跨进程深挖）：**最低优先，round5 再砍一刀**

- 正确性四档全平手（round1–4）+ **round5 跨进程×大仓也平手**（MAESTRO Python→R，with 11.7 vs without
  12.3 工具，with-arm 健康退回 grep）。
- **新 NO-GO：跨进程×大仓能力**。15 仓实测证明干净静态多跳兄弟脚本链（quarTeT 式）**不在 ≥1000 文件
  自然出现**；大仓跨进程是 Snakemake（已处理）/ 运行时动态串（grep & OmniWeave 共同天花板）/ Perl 编排器
  （caller 不索引）。**OmniWeave 跨进程护城河 = 小仓静态链（quarTeT 省 ~20%），不随规模放大。**
- **唯一仍有边际价值的能力改进**（低 ROI，证据驱动才做）：`%s/x.R` Python %-format 目录 + unique-basename
  解析（MAESTRO idiom），但需 dataflow/松动 fileExists 精度门，风险大、无第二 testbed → **不投**（§0.17）。

## 2）砸形态：**仍最高优先，但「层」要换**

形态税分两层，round5 实测把它们分离了：
- **变量层（explore-过度）= 路由已削平**：纯单点元数据题 routing→search，138k→92k 追平 grep。
  **范本③（round5）= server-instructions 查询类型路由**（20 行决策树，零新子系统、零回归）。
- **固定层（MCP 附着 ~34k：server-instructions + 工具 schema + ToolSearch 门控）= prompt 不可降**。
  4 版路由迭代证明：复合单点题 agent 稳定 find-then-read 2 round-trip、固定层留存。round4 已定「冷/暖缓存
  差 56×、稳态 ~1 turn、不值得抠」——**round5 坐实：prompt-routing 到此为止。**
- **下一步形态投资（按 ROI 排，全部「换层」）**：
  1. **降固定层 = 进程内/嵌入式甜点区**（§1.5①，向 Aider 形态靠：去 ToolSearch 门控、嵌入式查询、
     token 预算感知）。这是唯一能压低「单点题 with>without 那 ~34k」的路径，但属较大工程。
  2. **继续输出精度审计**（range3 qualified_name / round4 impact 截断 = 范本，token 经济一等指标）。
  3. **弱模型护城河**（haiku without 13 工具 vs with 2.7）——若目标用户用便宜模型，专门 A/B 矩阵。

## 3）垂直闭环（bio 领域包）：**维持 NO-GO**

round5 无新证据改变 STATUS §0.15。MAESTRO 实测反而再证：通用 polyglot 的诚实天花板（运行时安装目录脚本）
不是领域知识能补的——是 dataflow 问题。**不建。**

## 4）竞品定位（带数字，round5 补 MAESTRO 行）

| 对手 | 关系 | round5 新数字 |
|---|---|---|
| **grep/read** | 同语言反向赢随规模放大；**跨进程×大仓平手**（赢蒸发） | MAESTRO 11.7 vs 12.3 工具（平手） |
| **LSP** | 同语言同侪；跨进程/跨语言/零配置赢 | MAESTRO Python→R **三重失明**（无 R server / os.system 串无符号 / pyright 零配置解不了 import） |
| **Aider repo-map** | 范畴赢（无可走边） | 不变 |

**对外承重定位（v2 一句）**：**「OmniWeave 在同语言大仓反向/blast-radius 上用 1/20 工具、1/12 token
达到同样正确——这条护城河随规模放大；在跨进程/跨语言/动态分派上赢 LSP 的范畴失明、零配置赢 pyright。
但它不卖『跨进程在任意大仓都赢』（大仓真实 idiom 多在诚实天花板上），也不卖『更正确』（全档平手）——
卖『同样正确、同语言大仓更省、跨边界 LSP 够不着、零配置、对弱模型尤甚』。」**

## 5）下一步候选（若继续，按价值）

1. **降固定层（进程内甜点区，§1.5①）**：唯一能压低单点题固定 MCP 税的路径。最高形态 ROI，但工程量大。
2. **输出精度审计第 N 例**：找下一个「agent 得猜」缺口（trace 置信？explore 截断？）。
3. **弱模型护城河矩阵**：haiku/便宜模型上专门量化（round4 测到护城河更宽）。
4. ~~跨进程×大仓~~ / ~~bio 垂直闭环~~ / ~~prompt-routing 再迭代~~：**三者 round5 均证零增量，不投。**
