# NEXT-SESSION — OmniWeave 超严格审计 + 有用性深度证明（作战手册）

> 本文件是下一会话的完整手册。GOAL 文本只给入口，细节在这里。
> 一切遵循用户铁律：**证据优先**（有真实命令输出才算数）、**真实优先于 mock**、**并行优先**、**看真实源码不信 README/记忆**、**commit/PR 绝不加 AI 署名**、**push 只 origin 绝不 upstream**。
> **ultracode**：每个实质任务用 Workflow 并行 fan-out + 对抗式核验（让 skeptic agent 试图证伪每条结论/每个 win）。token 不是约束，完整正确才是。

## 0. 此刻状态（2026-06-24 交接）

- CLAUDE.md / AGENTS.md 的《工程交付强制规范》已从通用 UI/流式版**重写为 OmniWeave-native 版**（10 节，**锚名字不锚行号**）——这就是审计标准。两文件 174 行**逐字同步**（仅 header + git 署名 Claude/Codex 不同）：**改一个必须同步另一个**。
- 基线：`npm run build` 干净、`npm test`（two-phase = `test:unit` + `test:mcp-daemon`）= **1729 passed | 4 skipped（87 文件）**、**25 eval 门禁**、`npm run benchmark` = **5 wins / 1 tie / 1 grep**。
- 上一会话核验了一份草稿规范（58 断言，源码逐条核 = 86% confirmed，7 partial / 1 wrong）。已并入新规范的关键修正：`getExploreOutputBudget` 是 **5 档**（<150/<500/<5000/<15000/≥15000）非 4 档；`rS4DispatchEdges` 是**确定性结构边**（发 contains/overrides，**不带 provenance/confidence**），只有 `generalCrossLangEdges` 才是 heuristic + synthesizedBy + confidence。**这条「确定的算确定、猜的才标 confidence」分层是产品信任模型的灵魂，审计时重点守。**

## 1. 先读（按序，全是真实存在的当前文件）

1. **CLAUDE.md / AGENTS.md** — 尤其《工程交付强制规范》§0–§10 = 审计 checklist；前半「必须知道的真实事实」+ daemon-skew gotcha。
2. **CHECKPOINT.md** — 系统地图 + **PARK 表（已证伪方向，无新反证 A/B 数字别重投）** + 设计决策表。
3. **README.md** — 对外定位 + 七轮 A/B 证据摘要 + 诚实边界（它就是用「不宣称更正确」「平手照记」的口径写的，照此对齐）。
4. **eval-results/agent-ab-2026-06-23**（round 7 输出诚实化）、**agent-ab-2026-06-13**（rounds 1–6 效率）。
5. **memory**（`~/.claude/projects/-Users-liuzaoqu-Desktop-develop-sogen-OmniWeave/memory/`）。
6. **真 LLM 资源**：`~/Desktop/本机AI-API资源盘点.md`（MiMo Anthropic 协议·主力 / DeepSeek / Qwen / Tavily）——**绝不把 key 写进任何 commit / 文件 / 日志**。

## 2. 任务一：超严格审计（against 新规范，每个细节都极严）

**方法**：把《工程交付强制规范》§0–§10 的每条 invariant 当断言，对**真源码 + 真测试**逐条核。用 Workflow 并行 fan-out（复用上一会话的 `verify-delivery-spec-draft` 模式：每桶一个 agent，schema 化产出 `{断言 → PASS/FAIL → 真实值 → durable 锚点(名字非行号) → 证据命令}`），再对抗式核验。

**核查矩阵（不限于此，越细越好）**：

- **§0 铁律**：错边比漏边——审 `generalCrossLangEdges` 及**所有** synthesizer，有没有一条静态不可解却被 emit 的边？默认工具面真的是 5（小仓 3）？有没有偷偷加的工具 / 边类型 / 配置项？
- **§2 输出面**：空/失败成功形状、`CALL_SURFACE_EDGE_KINDS` 诚实、`showing X of Y` 真总数、`research/*/repos/*` 低信号过滤、续跳 key——每条配一个真实 CLI **和** MCP smoke 命令证明。
- **§3 预算**：`EXPLORE_INLINE_HARD_CEILING=25_000` 在**所有 wrapper（stale/worktree 通知）之后**真兜得住？5 档 per-file 单调不减？`truncateExploreAtCompleteBoundary` 只切完整 fenced/section 边界、绝不留半截围栏？stale 纪律（磁盘 re-read + 符号/边/行号可能滞后）？**造极端输入打它**（超大文件、宽 prose、空、歧义、已删源）。
- **§4 图信任**：`EdgeKind` 15 / `BRIDGE_EDGE_KINDS` 4 / `provenance` 3 真实集合一致；**S4 确定性 vs crossLang 启发式的分层在代码里真成立**（rS4 不带 provenance、generalCrossLang 带 confidence 0.85/0.8/≤0.7）；涟漪 6 处有没有漏改的不一致；SCIP / snapshot 信任门（staged verify / integrity_check / `validateSnapshotGraphText` 拒注入）。
- **§5 性能**：`PARSE_TIMEOUT_MS=10_000`(+10s/100KB) / `WORKER_RECYCLE_INTERVAL=250` / `MAX_FILE_SIZE=1MiB`、`LRUCache` 有界、`FileLock` 活 PID 拒抢、daemon atomic `link()` + `clearStaleDaemonLock` 仅清死 PID——**造并发 / 大文件 / 死活 PID 竞态打它**。给出索引 N 文件 P95、explore P95 字符、worker recycle 后 RSS 的**真实数字**。
- **§6 分发**：rebuild 后指纹必变、proxy↔daemon 不符转 in-process——**真进程 smoke**（detached daemon + 新 proxy，同版本不同 build id，复现「检测到 skew → in-process」）。
- **§7 统一**：CLI/MCP 同查询不矛盾（`explore-surface-parity`）、数值 `Number()` clamp（非 parseInt）、版本单一真值（npm=CHANGELOG=tag=指纹）。

**产出**：审计台账（每条 PASS/FAIL + 证据命令）→ 对每个 FAIL 立刻修 + 红→绿回归 → 全程 build+test 绿。
**spec↔代码冲突**：优先让代码达标（spec 是刚定的标准）；若 spec 本身有错，修 spec 并**同步 CLAUDE.md + AGENTS.md**。
**死代码/复杂度治理**（§1 奥卡姆 + §5 主动治理 + §9 七问）：找可删未删的工具/边类型/配置/分支并删之；清不诚实输出（silent cap / 半截截断 / 无 provenance 的启发式边）。

## 3. 任务二：有用性深度证明 + vs codegraph（一定多做实验）

**已有基线（别重复、要超越）**：rounds 1–7 agent A/B（~140 run / 15+ 仓 / 5 语言 / 2–3 模型），benchmark 5/1/1。结论：正确性全档**平手 grep**，护城河 = **努力**（工具数/token/turn/latency）+ **信任**（诚实输出）+ 随仓放大 + 模型越弱越宽。

**竞品就在仓里**：`research/2026-06-23-codegraph-ecosystem/repos/` —— `codegraph`（上游正牌，TS/tree-sitter；**有 R 抽取**，但 `setMethod` 塌成同名 `function` 节点、**无 S4 分派图**；EdgeKind 仅 12 类、**无 crossLang/produces/consumes/invokes**；`.smk/.nf` 不映射、**无 workflow DAG**——2026-06-24 实证见 `eval-results/vs-codegraph-2026-06-24/`，「无 R」旧说法已退役）、`codebase-memory`、`serena`、`codanna`、`aider`、`scip`、`blarify`、`repograph`、`graphify` … head-to-head 的真实弹药。

**要做更深的**：

1. **vs codegraph 逐能力对照**：同一批真实仓（含 R/bio polyglot + 大 TS/Python 仓）、同问题集，量 codegraph 拿不到而 OmniWeave 拿得到的边（**S4 分派 / crossLang 跨进程 / workflow DAG / invokes**）。产出**能力矩阵**（谁能遍历这条边/谁不能）+ 真实 explore 输出对照（贴双方原始输出）。这是 OmniWeave 差异化的根——codegraph 是 OmniWeave 的 fork 基座，正好做「我比我的来源强在哪」的硬证。
2. **agent A/B 用真 LLM（MiMo 主力）**：扩展 `scripts/agent-eval/ab-sufficiency.sh`（**fail-closed**：auth/空 jsonl/非零退出标 INVALID），多语料多模型，量「解决了 grep+LSP+codegraph 解不了的**真实问题**」。每个 win 配真实 transcript + 人判 ground truth。
3. **诚实纪律（铁律，违反=造假）**：**平手记平手**；**绝不宣称「更正确」**（护城河只锚努力/信任/可达性）；任何 win 可复现（脚本 + raw transcript 落盘）；**PARK 表的 NO-GO（跨进程×大仓 / 垂直 bio 三表 / 降形态税 / in-process 模式）没有新的反证 A/B 数字，不许重开**。
4. **产物**：`eval-results/agent-ab-<新日期>/RESULTS.md`（诚实边界 + 平手 + no-help 全写）；更新 README 证据段（如有新数）；`npm run benchmark` capability-matrix 更新或诚实说明不变。

## 4. 护栏（违反任一 = 失信）

- **真实优先**：用户可感知行为的最终证据用**真配置 provider 实测**（MiMo/DeepSeek/Qwen），绝不 mock 充数；**绝不把 key 写进 commit/文件/日志**。
- **自动化优先禁甩手动**：穷尽 harness/probe/headless 真跑，别把可自动化的活甩给用户手动。
- **验收门锚现实**：只硬门「客观可机器验证 + 判 OmniWeave 自己代码」的指标（测试/verify/eval/真实 explore 输出/进程 smoke）；纯平台/环境特性降级为可选人工确认，别造做不到的门再甩锅。
- **daemon-skew**：MCP 输出可疑/陌生 → 先疑旧 daemon，rebuild + 重连宿主，别先怀疑自己的查询。
- **git**：commit 只在一个 verified 单元完成（build+test 绿）时打 checkpoint；message 只描述改动、**绝不加 `Co-Authored-By` / `Generated with` / 任何 AI 署名水印**；push 只 `origin`、绝不 `upstream`、不 force-push main；**改 CLAUDE.md 必同步 AGENTS.md**。

## 5. DONE 定义（「super perfect」，全满足才停 loop）

1. 《工程交付强制规范》§0–§10 **每条 invariant 有 PASS 证据命令**；所有 FAIL 已修 + 回归绿。
2. `npm run build` 干净、`npm test` 全绿（含 `mcp-daemon` 10/10）、eval 门禁全过、`npm run benchmark` 不退（或诚实更新说明）。
3. 死代码/复杂度/不诚实输出清零，§9 七问逐条过。
4. **vs codegraph + 生态竞品的能力矩阵** + **真 LLM agent A/B 证据**落盘、可复现、诚实边界写清（含平手与 no-help）。
5. README / CHECKPOINT / CHANGELOG / memory 与最新真值同步；CLAUDE.md ↔ AGENTS.md 同步。

**每轮 loop 末尾**：跑 verify 门禁 + 把进度/新证据/下一步写进 CHECKPOINT，commit checkpoint（无 AI 署名）。

## 6. 节奏

ultracode：每个实质子任务起 Workflow 并行（审计 fan-out / 竞品对照 fan-out / A/B 矩阵 fan-out），并对抗式核验每个结论与每条 win（skeptic agent 默认证伪）。串行只用于改一个文件的机械编辑。**不做「差不多」**——任一项未达 DONE 即继续 loop。

## 7. 靠谱测试题库（任务二证明用 —— 先定 ground truth 再跑）

**铁律**：每题**先人工定死 ground truth**（标准答案 + 真实 `file:symbol` + 那条边的来源），再跑 A/B，否则判分主观 = 造假。每题标注**预期裁定**（effort-win / 正确性 tie / no-help），**必须含 tie 与 no-help 题**——只挑 win 题 = cherry-pick = 失信。每题 ≥3 run × ≥2 模型（MiMo 主力 + 一弱模型 如 Qwen/Haiku）；三臂对照：`grep+read` / OmniWeave / `codegraph`(或同语言 LSP)。题目须落在**可索引的真实仓 / fixture**（capstone、polyglot-subprocess、DESeq2 等 Bioconductor 包、Snakemake/Nextflow 真实 pipeline、vscode/大 TS 仓）。

### A. 差异化（OmniWeave 应赢 effort，或拿得到别人拿不到的边）
- **A1 S4 分派**（R/Bioconductor）：「泛型 `results()` 对类 `DESeqDataSet` 的 S4 方法实现在哪？override 了哪个 generic？」GT = `setMethod` 那行 + `Class::generic`。codegraph/grep 连不上 setMethod→generic。
- **A2 跨进程入口**（polyglot-subprocess / 真实流水线）：「`main.py` 用 subprocess 跑 `tool.py` —— `tool.py` 真正干活的入口函数是哪个？」GT = `crossLang` 边目标。**注意大仓跨进程是 PARK 的 NO-GO（运行时拼命令），小仓才赢——如实记。**
- **A3 workflow DAG**（Snakemake/Nextflow）：「rule `align` 的 output 被哪条 rule 当 input 消费？中间产物文件是哪个？」GT = `produces`/`consumes` 共享 artifact 节点。
- **A4 invokes 外部工具**：「pipeline 步骤 W 调了哪个外部二进制（bwa/STAR/samtools）？谁产出它的输入？」GT = `invokes` + 上游 `produces`。
- **A5 大仓反向 blast**（vscode/大 TS 仓）：「全仓什么调用 `F`？改 `F` 签名影响哪些？」正确性大概率 **tie**，OmniWeave 赢在**工具数/token（~1/20）**——量 tool-calls，别吹正确性。

### B. 诚实对照（必须做，证明不是 cherry-pick）
- **B1 单点 tie**：「`X` 定义在哪？」grep 平手 —— 记 tie，别包装成 win。
- **B2 同语言 + LSP tie**：「这个 TS 方法的所有 caller」—— tsserver 平手。
- **B3 概念 no-help**：「auth 逻辑在哪？」—— embedding 地盘，OmniWeave 不竞争，应明说「这不是结构问题，用语义搜」。
- **B4 虚分派 trap（正确性 tie）**：Java `Ordering.natural().reverse()` 类问题，naive read 返回错类 —— **两臂正确性都 tie**（OmniWeave 静态边也只到声明不到运行时分派），硬证「护城河不是更正确」。

### C. 输出诚实（round-7 复刻 + 强化）
- **C1 缺失符号**：查不存在的符号 —— 必须 <1K 恢复指引，**绝不倒 `research/*/repos/` 竞品快照**。
- **C2 否定特征**：「本仓做向量检索吗？」（答：不做，故意非特征）—— 干净空 + 不泄漏竞品 embedding 代码。
- **C3 stale**：改一个已索引文件不 sync 再查 —— stale banner + 磁盘当前字节 + 不让 agent 信旧行号/边。

### 判分维度
工具数 / input token / turn / latency（effort，机器抽）+ 正确性（人判 GT，二值）+ 稳定性（多 run 方差）。**正确性平手是常态、是诚实结论；effort 与 trust 才是结论。** 全部 raw transcript + 判分落 `eval-results/agent-ab-<新日期>/`，可复现（脚本入口 `scripts/agent-eval/`）。
