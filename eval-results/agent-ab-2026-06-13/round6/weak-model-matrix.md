# 轨道2 —— 弱模型护城河矩阵（haiku × 四档题型 × 模型强度曲线）

> 问题：**「护城河宽度 vs 模型强度」**——弱模型上护城河是否更宽、宽多少？round4 单题测到
> 「haiku without 13 工具 vs sonnet 7.7、with 都 ~2」，本轨建完整矩阵（四档 × haiku + sonnet 同题对照 × 3 run）。
> 复用已索引仓，judge=人工（提两 arm 答案 + DB GT）。原始 jsonl 见 `raw/t2-{haiku,sonnet}-*/`。

## 四档题型 + 可枚举 GT

| 档 | 仓 | 题（symbol） | GT |
|---|---|---|---|
| ① 单点 | DESeq2 (R) | `nbinomWaldTest` 签名/位置 | R/core.R:1333, sig `(object, betaPrior=FALSE, …)` |
| ② 反向 | django (3k) | `iri_to_uri` 全部 distinct callers | 17 distinct caller node |
| ③ 大仓 blast | django (3k) | `get_srid_info` 传递 blast radius | impact depth4 = 28 affected |
| ④ 跨进程(小仓) | quarTeT (7 文件) | `quartet.py` 起的 subprocess 脚本 | 4 crossLang 脚本 |

## HAIKU 矩阵（model=haiku effort=high，3 run/arm，工具数 / 输入 token 均值）

| 档 | WITH (工具/tok) | WITHOUT (工具/tok) | 正确性 | 护城河（effort） |
|---|---|---|---|---|
| ① 单点 | 3.3 / 145k | 3.0 / 127k | 平手（both core.R:1333） | **负**（+0.3 工具、+18k tok）——grep 主场 |
| ④ 跨进程·小仓 | 2.3 / 106k（**omni=0**） | 2.0 / 93k | 平手 | **中性**——haiku 7 文件直接 grep，**没调 omniweave** |
| ② 反向 | 4.5 / 178k（剔 1 个 48 工具 flail） | 13 / 301k | 平手（~17 both） | **打开 ~3× 工具 / ~1.7× tok** |
| ③ 大仓 blast | **2.3 / 96k** | **~26 / ~1.27M** | 平手（with 28 / without 31-32） | **巨大 ~11× 工具 / ~13× tok** |

**护城河随查询结构单调变宽**：单点（负）→ 小仓跨进程（中性）→ 反向（~3×）→ 大仓 blast（~11×）。与 sonnet 同形。

### 弱模型的三个诚实发现（非 cherry-pick）

1. **弱模型工具选择不可靠 = 护城河「真实但实现不稳」**。reverse-with-r2 一次 **48 工具 / 2.4M tok / omni=0**——
   haiku **完全无视挂着的 omniweave、自己 grep flail**（比 without 还惨），最后才答 16（仍对）。3 run 里 2 次正常用图
   （4-5 工具）、1 次彻底 flail。**护城河只在弱模型真选了图工具时兑现**；它不像 sonnet 那样稳定选图。这是弱模型护城河
   的真实形状：**期望值更宽、方差也更大**。
2. **without-arm 的绝对 flail 成本在弱模型上更高**。blast without haiku 烧到 **806k–1.7M tok / 17-32 工具**
   （sonnet round3 同类 django impact without ~339k）——弱模型无结构时 grep loop 更失控 → 护城河绝对值更大。
3. **小仓跨进程 haiku 不用图**（omni=0），印证 round5「小仓 grep 够」：弱模型在小仓更倾向直接 grep，图无用武之地。

## SONNET 对照（同题，model=sonnet effort=high，3 run/arm）

| 档 | WITH (工具/tok) | WITHOUT (工具/tok/turns) | 正确性 |
|---|---|---|---|
| ① 单点 | 2.0 / 95k | 2.3 / 91k | 平手 |
| ④ 跨进程·小仓 | 2.0 / 94k | 2.0 / 90k | 平手 |
| ② 反向 | 3.3 / 108k | 12 / 200k / 8-17 turns | 平手（17,17,12prod-only） |
| ③ 大仓 blast | 2.0 / 94k | **39 / 65k / 2 turns（全并行 grep）** | 平手（28 vs 32） |

## 护城河宽度 vs 模型强度 —— 完整对照 + 曲线

**WITH 图：两模型都坍缩到 ~2-3 工具 / ~94-145k tok / 3 turns**——**图把模型强度差异抹平**（结构答案一次调用，与模型无关；haiku 略重于 find-then-read + 偶发 flail）。

**WITHOUT 图：护城河在结构题（反向/blast）打开，但「宽多少」依指标分裂——这是本轨最重要的诚实发现**：

| 指标 | blast haiku without | blast sonnet without | 含义 |
|---|---|---|---|
| 工具数 | ~26 (17-32) | ~39 (33-48) | sonnet **更多**（并行 grep） |
| 输入 token | **66k–1.73M（方差极大）** | **65k（稳定）** | **关键分歧** |
| turns | **2 / 18 / 33（不稳）** | **2 / 2 / 2（稳）** | **关键分歧** |

**根因**：强模型（sonnet）**可靠并行化** grep（blast without 一次发 33-48 个并行 grep/read，2 turns 收敛、token 低）；
弱模型（haiku）**不会稳定并行、退化为串行 flail**（最坏 33 turns / 1.73M tok）。**图把两者都拉回 ~94k / 3 turns。**

### 回答「弱模型上护城河是否更宽、宽多少」

1. **工具数维度**：两模型都宽（结构题 without 都 fan out 到 12-39 工具，with 都 ~2）；强模型因并行反而工具更多。**这一维度护城河不随模型变弱而更宽。**
2. **token / turn / 延迟维度（真正决定成本与体验的）**：**弱模型上护城河显著更宽**——强模型靠并行把 without 的 token/turn 成本压住（blast 65k/2turns），弱模型压不住（最坏 1.73M/33turns）。图消除的「最坏情况串行 flail」只发生在弱模型 → **弱模型的护城河 = 期望更宽、最坏情况宽 10-25×、且方差更大**。
3. **捕获可靠性维度（反向发现）**：弱模型护城河**更难兑现**——haiku 3 run 里 1 次完全无视挂着的图、自己 grep flail（reverse-r2: 48 工具/omni=0）；sonnet 每次都用图。**所以弱模型「潜在护城河更宽，但实际捕获率更低、方差更大」。**

**一句话曲线**：护城河随①查询结构（单点→blast 单调变宽，两模型同形）②模型变弱（在 token/turn 维度变宽，因弱模型 grep-loop 退化为串行 flail、无法并行补偿）双重放大；但弱模型的捕获不稳定（偶尔不用图）是这条护城河的真实折扣。**round4「haiku without 13 vs sonnet 7.7」的简单结论，被 round6 精化为：差异主要在 token/turn（串行 flail）而非工具数（强模型并行），且要打捕获率折扣。**
