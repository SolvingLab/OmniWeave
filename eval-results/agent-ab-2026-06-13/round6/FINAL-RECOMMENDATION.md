# OmniWeave —— 终版带数字总建议 v3（round6 收口，2026-06-14）

> 基于六轮 / ~100+ headless A/B run / 15+ 仓 / 5 语言 / 2 模型 / 3 基线。每条带数字、可复核
> （`eval-results/agent-ab-2026-06-13/`）。本文在 `../round5/FINAL-RECOMMENDATION.md`（v2）上叠
> round6 三个收口发现，并下**最终 saturation 论断**。

## 一句话（v3）

**砸形态 > 砸能力 > 垂直闭环 仍成立；round6 把「砸形态」也走到了诚实尽头**：
- **输出精度（形态的可降变量层）= 已系统审计到饱和**。callers/callees 的最后两个「agent 得再推导」
  缺口（截断谎报 + import 噪音）已修，红→绿门禁 + A/B 实测；其余工具（explore/node/impact）round3/4 已补齐。
  **再审计无可修缺口 = 输出精度饱和。**
- **固定层 = round6 实测证明「几乎不存在 OmniWeave 那部分」**。round6 隔离 A/B 决定性推翻 round5 的「~34k 固定
  MCP 层」归因：同题同模型两臂 warm first-turn = without 30,586 vs **with 31,268，OmniWeave 边际仅 +682 tok**；
  那 ~30k 是 **base Claude Code harness**（内置工具 deferral + ToolSearch 机制），两臂都有、非 OmniWeave 的。
  **关门控（候选②）不省反贵 +16k**（eager 全载 schema）——门控已是 token 最优。**所以固定层不是 OmniWeave 的问题、
  无需「换形态降」**；进程内 mode 的 ROI 上限从 ~34k 降到 ~682 tok → **更清晰 NO-GO**（赌不存在的宿主去省 682 tok）。
- **护城河随模型变弱而变宽 = round6 量化为完整曲线**（四档题型 × haiku vs sonnet）。

## 1）砸能力（堆边/堆语言/跨进程深挖）：**最低优先，六轮无新增价值**

- 正确性全档平手（round1–5）+ round5 跨进程×大仓也平手。round6 未再投能力（已饱和）。
- **NO-GO 清单不变**：跨进程×大仓能力、bio 垂直闭环、堆第 N 类边/第 M 门语言。

## 2）砸形态：**仍最高优先，但 round6 把两层都走到尽头**

### 2a. 变量层（输出精度）= 审计到饱和
- round3 `qualified_name`（callers 补 owning class）、round4 `impact` 深度截断、**round6 callers/callees
  截断谎报 + import 噪音** —— 三例输出精度修复，范式一致（红→绿门禁 + A/B 实测降 + 零正确性损失）。
- round6 系统审计全部 MCP 工具输出：explore/node/impact 的截断信号 round3/4 已到位；callers/callees 是
  最后的缺口，已修。**再审计无可修缺口 → 输出精度饱和**（本身是有价值的「已到位」结论）。

### 2b. 固定层 = round6 实测证明「几乎没有 OmniWeave 那部分」，问题自我消解
- **决定性纠偏**（`RESULTS-round6.md` 轨道3.1 隔离 A/B）：round5 的「~34k 固定 MCP 层」绝大部分是 **base Claude
  Code harness**（内置工具 deferral + ToolSearch 机制），同题同模型两臂 warm first-turn = without 30,586 vs
  **with 31,268 → OmniWeave 边际仅 +682 tok**。schema 在默认门控下被 defer、不进系统提示。
- **关门控（候选②）不省反贵 +16k**（eager 全载 schema）——门控已是 token 最优，round4/5「关门控省 token」对延迟成立、
  对 token 证伪。**候选① 裁字节 ROI ≤ 682 tok 且带差异化风险 → 不裁。**
- **进程内 mode**：ROI 上限从 ~34k 降到 ~682 tok + 无第二方宿主 testbed（§0.17 红线）→ **更清晰 NO-GO**。
  详见 `in-process-mode-derisk.md`。
- **结论**：round5「下一步形态投资=降固定层」基于错误归因；**固定层不是 OmniWeave 的问题**，无需投。

## 3）垂直闭环（bio 领域包）：**维持 NO-GO**（六轮无新证据）

## 4）竞品定位（带数字，round6 不变 + 补弱模型曲线）

| 对手 | 关系 | 数字 |
|---|---|---|
| **grep/read** | 同语言反向赢随规模放大；跨进程×大仓平手 | 大仓反向 1/20 工具、1/12 token；**弱模型上护城河在 token/turn 维度更宽**（haiku blast without 最坏 1.73M/33turns vs sonnet 65k/2turns，因弱模型不会并行 grep），但捕获不可靠（haiku 偶尔不用图） |
| **LSP** | 同语言同侪；跨进程/跨语言/零配置赢 | pyright 零配置 0/17 caller；无 R server |
| **Aider repo-map** | 范畴赢（无可走边） | 不变 |

**对外承重定位（v3 一句）**：**「OmniWeave 在同语言大仓反向/blast-radius 上用 1/20 工具、1/12 token 达到
同样正确——这条护城河随规模放大、且模型越弱越宽；在跨语言/跨进程/动态分派上赢 LSP 的范畴失明、零配置赢
pyright。它不卖『更正确』（全档平手）、不卖『跨进程在任意大仓都赢』（大仓蒸发）——卖『同样正确、同语言大仓
更省、跨边界 LSP 够不着、零配置、对弱模型尤甚』。**它的固定附着开销实测仅 ~682 tok**（round5 担心的 ~34k 是
base harness、非 OmniWeave），所以没有需要『换形态』去还的形态债。」**

## 5）最终 saturation 论断（验收5）

**六轮后，再加轮/仓/题/语言/模型是否还改变结论？答：不会。** 逐维论证：
1. **再加正确性题**：六轮（含 round4 专门构造的虚分派陷阱/跨进程/深传递）全档平手，分歧假设决定性证伪。
   有能力 agent 读源码自核验；OmniWeave 对运行时分派本就诚实天花板。**再加题只会更平。**
2. **再加仓/语言（能力）**：round5 15 仓实测证跨进程×大仓 idiom 收敛到三类（已处理/动态串/安装目录），
   无第 4 类会让 OmniWeave 拉开。堆语言只是把 caller 接进来，目标仍是动态串。**饱和。**
3. **再加输出精度审计**：round6 系统审计全部工具，explore/node/impact 已补齐、callers/callees 已修，
   无第三类「agent 得猜」缺口。**饱和。**
4. **再迭代 prompt/路由**：round5 4 版到顶。**饱和。**
5. **再降固定层**：round6 实测 OmniWeave 边际固定成本仅 ~682 tok（其余是 base harness）、关门控反贵 +16k——
   **固定层本就几乎不存在，无需降**；进程内 mode 既无 testbed、ROI 上限又只有 ~682 tok → 双重 NO-GO。**饱和。**
6. **再加模型**：round6 量化 haiku vs sonnet 护城河曲线（模型越弱越宽，单调）——加更强模型只会让护城河更窄
   （趋近 0，因为强模型 grep 也够），加更弱模型只会更宽。**曲线已定形，加点不改形状。**

→ **OmniWeave 的「全球最好」边界已钉死**：在「同语言大仓反向/blast-radius + 跨边界结构（LSP 盲区）+
零配置 + 弱模型」这个**交集**里，它是可辩护的最省形态；在这个交集**之外**（正确性、跨进程×大仓、固定层、
强模型同语言单点），它诚实地平手或有成本。**六轮已把这条边界的每一面都实测到位——这就是饱和。**

## 6）下一步（若仍要投，按剩余 ROI，全部低）

1. ~~输出精度审计~~（round6 饱和）/ ~~prompt-routing~~（round5 饱和）/ ~~跨进程×大仓~~ / ~~bio 闭环~~：**不投。**
2. **进程内 mode**：NO-GO until 出现第二方宿主（届时按 `in-process-mode-derisk.md` §5 最小原型起步）。
3. **文档化固定层缓解**：把 `ENABLE_TOOL_SEARCH` 建议写进 README（零工程，立即可用）。
