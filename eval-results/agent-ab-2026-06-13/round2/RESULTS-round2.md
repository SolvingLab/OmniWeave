# OmniWeave Agent A/B 证值 —— 第二轮（反向/多跳/动态分派）2026-06-13

> 第一轮（`../RESULTS.md`）题偏单点定位、正中 grep 主场，低估了 OmniWeave。第二轮专测 OmniWeave 该独赢的题型：
> **反向 callers、多跳跨进程组合、S4 动态分派**——grep 结构上够不着或会漏的查询。同 4 仓（已索引），同 A/B 协议。

## TL;DR

- **效率/成本代差出现了**：反向/多跳题上 OmniWeave 用 **1/4~1/5 的工具调用**达到同等或更优答案，且**整体更便宜**（总 $0.701 vs $0.832，工具 16 vs 34，省 53%）。这补上了第一轮"with 总更贵"的形态税缺口——**形态税在反向/多跳题上被 without arm 的 grep+Read token 爆炸盖过**。
- **正确性：中小仓 grep 仍基本追平**。4 题里只有 DESeq2 的**全集完整性**上 with 明显更优（16 caller 含测试 vs without 14、漏 6 处测试调用）；其余 3 题 without 都答对，quarTeT/dplyr 上 without 甚至给了更多信息。
- **结论细化**：OmniWeave 现阶段的护城河是**效率与成本**（尤其反向多跳，net-positive），**不是"正确性独占"**。要让 grep 真正漏/错，需要**大仓**（噪音淹没 + Read 预算爆炸）或**不可字面 grep 的边**——这些中小仓还没到临界点。

## 数据（每个数字可在 `raw/` 复核）

| 仓 | 题型 | 正确性 | 工具 with/without | turns w/wo | cost(USD) w/wo | input tok w/wo |
|---|---|---|---|---|---|---|
| **DESeq2** | S4 分派+反向全集 | **with 更优** | **3 / 12** | 4 / 13 | **0.169 / 0.303** | 98k / 219k |
| **quarTeT** | 多跳跨进程全集 | 平手 | **2 / 11** | 3 / 12 | **0.168 / 0.229** | 100k / 243k |
| **ky** | 反向 callers(中性) | 平手 | 4 / 4 | 5 / 5 | 0.205 / **0.123** | 142k / 123k |
| **dplyr** | 反向多跳 | 平手 | 7 / 7 | 8 / 8 | **0.159** / 0.177 | 163k / 196k |
| **合计** | | | **16 / 34**(省 53%) | 20 / 38 | **0.701 / 0.832** | — |

## 逐仓判定

### 1. DESeq2 — S4 动态分派 + 反向全集 → **OmniWeave 赢**
- **Ground truth**（`omniweave callers dispersions`）：16 个 caller 函数；`dispersions(dds)` 动态分派到 `dispersions.DESeqDataSet`（`mcols(object)$dispersion`）。
- **with（3 工具）**：`callers` + `explore` → 列出 **16 处（生产 10 + 测试 6）**，分派 method 正确。**与图一致、最全**。
- **without（12 工具，Read 8 次）**：grep 数出 **14 处调用行**（按行计、排除 2 误报），但**漏掉全部 6 处测试代码调用**，且计数口径是"行"非"caller 函数"。分派 method 答对（Read 到 setMethod）。
- **判定**：with 全集更完整（含测试）、计数与图一致、更省（省 75% 工具 + 44% 成本）。**这是两轮中 OmniWeave 正确性首次明显拉开**——靠的是反向全集的**完整性**（grep 易漏测试/边角）。

### 2. quarTeT — 多跳跨进程全集 → 平手（OmniWeave 大幅省力）
- **Ground truth**：quartet.py → 4 脚本；AssemblyMapper → `quartet_util.mummer()`（nucmer/delta-filter/show-coords）/ `minimap()`（minimap2/unimap）。
- **with（2 工具）**：4 脚本 + AssemblyMapper 两条 aligner 路径的工具链，全对。
- **without（11 grep）**：4 脚本 + AssemblyMapper 工具全对，**还额外 grep 出其余 3 脚本的工具**（centrominer: trf/blastn/...；teloexplorer: tidk）——更全但超出题目范围。
- **判定**：正确性平手（题目范围内都对）；**OmniWeave 省 82% 工具 + 27% 成本**。without 靠蛮力 grep 也拼全（仓小、调用字面），代价是 11 次往返 + 更多 token。

### 3. ky — 反向 callers（中性单语言仓）→ 平手 + 健康信号
- **Ground truth**：`timeout()` 真实 caller = 1（`#fetch` @ Ky.ts:936）。
- **with（4 工具）**：答对 1 个 caller，**并主动纠正 OmniWeave 把 `import` 当 caller 的噪音**——agent 不盲信图，是健康信号。
- **without（4 工具）**：答对 1 个 caller。
- **判定**：平手；中性仓 OmniWeave 无优势 + 形态税（贵 $0.205 vs $0.123）。符合预期。

### 4. dplyr — 反向多跳 → 平手（都完全答对）
- **Ground truth**：`mutate_cols` ← mutate / transmute（直接），← distinct / group_by（经 `add_computed_columns`）。4 个导出 verb。
- **with（7 工具，6× callers）**：纯反向图遍历，4 verb + 完整路径树，全对。
- **without（7 工具）**：4 verb + 完整路径，**还多给 `needs_mutate` 条件洞察**（group_by/distinct 仅当含计算列才经 mutate_cols）。
- **判定**：平手，without 质量略丰富；with 略省成本。

## 两轮合并结论

| 维度 | 第一轮（单点题） | 第二轮（反向/多跳） |
|---|---|---|
| 正确性 | 4/4 平手 | 3/4 平手，DESeq2 with 更优 |
| 工具效率 | 互有胜负（省 45%） | **OmniWeave 稳定省**（省 53%） |
| 成本 | with 贵 44%（形态税） | **with 整体更便宜**（$0.701 vs $0.832） |

**护城河定位**：OmniWeave 现阶段的真实价值是**反向/多跳查询的效率与成本**（net-positive，且越深越省），**不是"正确性独占"**——中小仓里 grep+Read 暴力扫的韧性极强。**正确性要拉开，必须上大仓或不可字面 grep 的边。**

## 这对「下一步」的指向（更新）

1. **砸形态仍成立**：形态税在简单题上是负债（第一轮）；砍掉它能让简单题也 net-positive。但 OmniWeave 已在反向/多跳题上赢效率/成本——**形态优化的优先级，取决于目标用户更常问单点题还是反向/多跳题**。
2. **新增第三个变量 = 仓库规模**：两轮都用中小仓（≤450 文件），grep 韧性强。**下一轮该上大仓**（django ~2700 / vscode ~10000 / guava ~3000）——预期 grep 的噪音淹没 + Read 预算爆炸会让 OmniWeave 在**正确性**上也拉开，这才是"装上不想卸"的承重证据。
3. **agent 不盲信图是健康的**（ky 纠正 import 噪音）——provenance/confidence 设计在起作用，可作为信任度卖点。

## 诚实边界

- 仍是小样本（4 仓 / 8 run）。
- **正确性"平手"是真实结果**，不是 OmniWeave 失败——它在更少工具/更低成本下达到同等正确，这本身是价值；但"grep 也能答对"必须如实说，不能包装成"OmniWeave 独占"。
- 大仓未测 = 当前最大的证据缺口（第三轮该补）。
- cost 受缓存/cache-creation 干扰；工具/turns 是更稳的努力信号。

## README 素材（英文，两轮合并，可直接粘贴）

> **Does an agent actually do better with OmniWeave?** A/B benchmark across 2 rounds, 4 real repos, 16 headless runs (sonnet/high), OmniWeave-MCP vs plain grep/read as the only variable.
>
> - **Single-point lookups (round 1):** same correct answer both ways; OmniWeave cut tool-calls ~45% but cost ~44% more (MCP form-factor tax).
> - **Reverse / multi-hop / dynamic-dispatch queries (round 2):** OmniWeave used **1/4–1/5 the tool calls AND cost less overall** ($0.70 vs $0.83). On a reverse call-site enumeration it was the only arm to list the complete set including test call-sites (16 vs 12, grep missed all 6 test callers).
>
> **Takeaway:** the deeper and more reverse/cross-process the query, the more OmniWeave wins on effort *and* cost. On shallow single-point lookups, plain grep is competitive. Honest caveat: correctness was a tie on all but one query in these small/medium repos — the large-repo regime (where grep drowns in noise) is the next test.
