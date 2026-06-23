# OmniWeave — 2026-06-23 Codex 自主会话复盘 + 下一步深度计划

> 来源：`~/.codex/sessions/2026/06/23/rollout-...019ef2a8....jsonl`（38 MB / 17,273 行 / 43 turn / 28 次 compaction）
> 复盘人：Claude（Opus 4.8），证据全部为本机实测，非凭会话自述。
> 生成时间：2026-06-23

---

## 0. TL;DR（30 秒）

- 你用 Codex **goal 模式**挂了一个 9.5 小时的自主跑（04:06→13:39），一条 `/goal` 定方向，全程只插了 3 句话，主线写代码 + N 个**只读 subagent** 做安全/测试审计。
- 产出：**70 个 commit**，全部围绕 **P0「explore 默认输出面可信化」+ P1「snapshot 导出/导入」+ P1「可选 SCIP 导入」**，外加一个**已绿但未提交**的尾巴（snapshot 图文本注入防御）。
- 实测当前态：`build` 绿、focused 测试绿（73 passed）、`benchmark` **5 wins / 1 tied / 1 grep**、`main` 领先 `origin/main` **70 个 commit 未 push**。
- 战略方向**判对了**——这一跑几乎全押在「形态/可信度」而非「新能力」上，正好吻合你之前 A/B eval 得出的 **FINAL-REC v2：砸形态换层 > 砸能力**。
- 但有一个**结构性窟窿**：70 个 commit **没产出任何一条新的 agent 成本证据**，benchmark 针一动没动，A/B harness 这一跑只「加固」（fail-closed）却**从没真跑出新数字**。按你自己的「证据优先」铁律，这一跑的「证明」半边是缺的。
- 还有一个**操作级地雷**被你当场抓到：常驻 MCP daemon 用的是旧 dist，导致 `omniweave_explore` 在会话里**对你自己说谎**（旧 `isLowSignalSourceQuery` 报错）。这是分发/新鲜度可信度问题，值得单独治。

---

## 1. 这个会话是什么形态

| 维度 | 事实 |
|---|---|
| 驱动方式 | Codex Desktop `/goal` 长目标，**Aggressive Autonomous Mode**，每轮自动重注入 goal |
| 时长 / 规模 | 9.5 h，43 turn，28 次 context compaction，2,143 条 message，3,183 次 function_call |
| 人工介入 | **仅 3 次**（见下），其余全自主 |
| 并行 | 多轮 fan-out **只读 subagent** 做审计（turn 33 三个、36 两个、37 Dalton+Godel、39 两个、40 三个）；主线独占写文件，避免并发冲突 |
| 提交纪律 | 前 32 turn **一律不 commit**（goal 默认「未要求不提交」）；你第 2 次介入后改为**有改动就 commit**，从 turn 32 起连提 70 个 |

### 你给的目标（提炼自 `/goal` 原文 + `NEXT_SESSION_SUPER_GOAL.md`）

**一句话野心**：把 OmniWeave 做成 coding agent 时代「最强、最可信、最克制、最可验证的**代码结构控制层**」——不是更快的 grep、不是泛知识图、不是向量记忆。

**优先级**：
- **P0** 压实 `omniweave_explore`/CLI `explore` 默认输出面：ranking / budget / truncation / call-path / edge significance / ambiguous / empty / stale / large-repo，补测试 + MCP/CLI 一致。
- **P1** schema 版本化 snapshot 导出/导入：hash/fingerprint、manifest、只读校验导入、stale warning、安全 reindex。
- **P1** 可选 SCIP importer：只读 `index.scip`，同语言精确事实导入为 `provenance=scip`，不膨胀核心安装。
- **P2**（推迟）semantic sidecar 只做概念入口/排序，绝不造结构事实；graph-backed PR review vertical。

**红线**：不默认扩成 14+ MCP 工具；不把向量召回当结构事实；不把 LLM docs / Neo4j-Kuzu-Falkor / 多 UI / 自由查询语言塞进核心；不静态伪造运行时事实；**无 eval 不加 edge kind**；不为「宏大」牺牲安装/性能/克制。

### 你的 3 次人工介入（全部信号很强）

1. **08:21**「全局可以碰 commit，而且你要多碰 commit，有改动就要 commit，不然你后面都忘了」→ 提交纪律从「攒着」翻转为「小步快提」。
2. **08:30**「之前很多修复没有 commit 的，你要深度增加，深度一些——这个可以用 N 个 SubAgent 来干！！！」→ 启用并行只读审计。
3. **13:16**「这不会是本地没有更新 omniweave 这个软件吧！！！『omniweave_explore 仍在报 isLowSignalSourceQuery 内部错误』」→ 抓出 **daemon/dist 偏移**这个真 bug。

---

## 2. 实际产出（按优先级分桶）

### P0 — explore 默认输出面可信化（占了绝大多数 commit）

把「explore 是 agent 的主读原语」这件事往**克制 + 诚实**方向压实，典型刀法：

- **低信号污染封口**：宽查询不再被 `research/*/repos/*` 竞品源码快照、`site/`、`examples/`、CamelCase 子词（`format` 被 `formatContext` 带出）污染；只有显式问 `snapshot/research/external` 才放行。
- **空/缺失/stale/空索引**：空结果返回**成功形状的恢复指引**（不是裸死路）；stale 时明确区分「源码块是当前磁盘字节 vs 图里的符号/边/行号可能滞后」；0 文件索引有专门文案；无 watcher 时复用 `getChangedFiles()` 兜 freshness。
- **截断诚实**：`Complete source for N files` 只在真完整时出现；hard ceiling（25K）在所有 notice 包裹后再裁一次，只在完整 fenced block 边界截断，不出半截代码块。
- **call-path 诚实**：callers/callees/impact/blast-radius 只把 `calls/crossLang/invokes/instantiates` 当调用面，`references/imports/returns` 不再伪装成调用并报 omitted 计数；关系区标「supporting facts, not call path」，启发式/SCIP 边显示 provenance+confidence。
- **稳定续跳 key**：explore/search/node 输出统一 `omniweave_node symbol="..." file="..." line=N`，下一跳精确 pin，避免二次消歧。
- **CLI/MCP 一致性**：数字参数整值解析 + 范围 clamp（弃 `parseInt` 半截）、未索引项目 exit 0 + stdout 指引、`--file` 窄化同名符号、help 文案区分默认 5 工具 vs opt-in。
- **proxy `tools/list` 漏洞**（Godel 审计发现）：normal daemon/proxy 路径绕过了动态预算和 tiny-repo 工具收缩，已修 + 真 daemon 测试覆盖。

### P1 — snapshot 导出/导入

- `src/snapshot.ts`：`exportSnapshot`（跨进程写锁 + WAL checkpoint + 复制 DB + manifest：schema/version/graph counts/language/source-root fingerprint/sha256）、`verifySnapshot`、`importSnapshot`（manifest/schema/hash 校验、stale 检测、路径逃逸拒绝、默认拒 stale、默认不覆盖、staging/backup/restore）。
- **信任边界**（subagent 审计驱动）：拒 ghost path、`integrity_check`/`foreign_key_check`、lock 内复核 `.omniweave` 身份防 symlink/TOCTOU、manifest 反算校验防伪造展示字段、不写绝对 `sourceRoot.path`（防泄漏用户名/目录）、禁止导出到活动 `.omniweave`、artifact-only verify 给 target 未校验 warning。
- **未提交尾巴**：`validateSnapshotGraphText` —— 拒绝 snapshot 里不安全的 agent-facing 图文本（``` 围栏、`ignore previous instructions`、控制字符、超长字段），这是**针对「导入的快照投毒 agent 上下文」的提示注入防御**。已实测 build + focused 测试**全绿**，只是会话被截断没来得及提交。

### P1 — 可选 SCIP importer

- `src/scip/protobuf.ts`（无外部依赖的安全子集 reader）+ `src/scip/importer.ts`：读现成 `index.scip`，只导同语言 `references/implements/type_of`，全标 `provenance=scip`，**不造 `calls`、不跑 indexer、不进核心安装路径**。
- 边界：路径校验、unsupported language 跳过 + warning、只补已索引文件、stale base index 跳过、occurrence range 上限 + 行列边界、fallback 节点名必须有 verified source range 支撑、artifact 字段转义换行/反引号/控制字符。
- `omniweave_impact` 现在标出 `provenance=scip` 影响半径，直接 SCIP 触达的符号加 `[scip]`。

---

## 3. 当前真实状态（我刚实测）

```text
npm run build                         → BUILD_OK
focused vitest（snapshot/scip/skew）  → 73 passed | 1 skipped
npm run benchmark                     → 5 OmniWeave wins / 1 tied / 1 grep win
git: origin = SolvingLab/OmniWeave    → main ahead 70 / behind 0（70 commit 未 push）
工作区                                → M src/snapshot.ts  +  M __tests__/snapshot-import.test.ts（即上面那条已绿的尾巴）
```

会话内最后一次全量是 `86 files | 1718 passed | 4 skipped`；加上未提交的 1 条 snapshot 测试，当前实际 ≈ 1719。CHECKPOINT.md 里记的 `1647` 已**滞后**（停在 turn 32 那次 checkpoint 写入）。

---

## 4. 诚实评估

### ✅ 做对了的

1. **战略方向对**：几乎全部精力压在「形态/可信度/输出克制」而非「堆新能力」，与你 A/B eval 的结论 **FINAL-REC v2（砸形态 > 砸能力）** 完全一致。没有去碰已被你判 NO-GO 的 cross-process@大仓、垂直 PR-review。
2. **trust-boundary 扎实**：snapshot/SCIP 的安全面（路径逃逸、TOCTOU、伪造 manifest、提示注入）做得像样，这正是「冰山下面 90%」。
3. **subagent 用法对**：只读审计 + 主线独占写，避免并发写冲突——这是把「N 个 subagent」用在刀刃上，而不是并行写码互相踩。
4. **提交纪律被你纠正后到位**：70 个 commit 粒度小、信息清晰、无 AI 署名（守住了红线）。

### ⚠️ 漏掉/跑偏的（这是计划要补的）

1. **70 commit = 0 新证据（最大问题）**。你的铁律是「每个新增能力用 eval/A-B 证明能减少 agent 工具调用/token/错误修改」。这一跑做了海量「诚实化」，但 `benchmark` 针**一动没动**（5/1/1 始终如一），agent A/B harness 只「加固成 fail-closed」却**从没真跑出一组新数字**。结果是：你无法回答「这 70 刀到底让 agent 省了多少读 / 少错几次」。**注意**：benchmark 是能力矩阵，本就测不出「输出诚实度」的收益——量化形态收益**必须**跑 A/B harness（token/read 计数），而这一跑恰好没跑。
2. **70 commit 未 push**。你第一句介入就是怕「后面都忘了」，结果 70 个 commit 全压在本机单点。一旦磁盘/误操作，9.5h 蒸发。
3. **daemon/dist 偏移让工具自己说谎**。你当场抓到的 `isLowSignalSourceQuery` 不是源码 bug，是常驻 MCP 进程吃旧 dist。这是**分发可信度**问题：一个号称「最可信」的工具，自己的运行实例可能在对用户撒谎。值得一个自愈机制，而不只是「重启就好了」。
4. **文档数字滞后**：CHECKPOINT/README 的 test count 停在 1647，落后真实 ~70。
5. **自主 loop 漂移成「micro-hardening」**：43 turn 里 30+ turn 是「再封一个低信号口子 / 再加一条 stale 文案」，边际收益递减，却没有一个「该停下来重新量北极星」的闸。loop 缺一个 **per-N-commit 必须重跑 eval** 的门。

---

## 5. 下一步深度计划

> 排序原则严格继承你的两条先验：①**证据优先**（没测过不算数）；②**砸形态 > 砸能力**（A/B eval FINAL-REC v2）。
> 每个 Phase 都有明确「Done when」+ 验证命令，绝不停在建议层。

### Phase 0 — 收口这一跑（≈30 min，今天就做）

把 9.5h 的成果**落袋为安**，消除单点风险与「工具说谎」。

- [ ] **提交尾巴**：`src/snapshot.ts` + `snapshot-import.test.ts`（已绿）→ 一个 commit：`Reject unsafe agent-facing snapshot graph text`。
- [ ] **决定 push**：70 commit 未推。建议 `git push origin main`（origin = 你的私有 SolvingLab/OmniWeave，非 upstream，安全）。**这是唯一需要你点头的不可逆/外发动作**——你不发话我不推。
- [ ] **刷新 daemon**：杀掉旧 MCP 常驻进程，让 Codex/Claude 重连吃新 dist，验证 `omniweave_explore` 不再报 `isLowSignalSourceQuery`。
- [ ] **同步数字**：CHECKPOINT.md / README.md 的 test count 更新到真实值（跑一次全量 `npx vitest run` 取准数）。

**Done when**：工作树干净、origin 与 main 平、MCP 实例返回新行为、文档数字 = 实测数字。

### Phase 1 — 把 70 刀变成证据（≈半天，最高优先）

这是补上这一跑缺的另一半。**不写新功能，只量化已做的。**

- [ ] 用本机真 LLM 资源（`~/Desktop/本机AI-API资源盘点.md`，MiMo/DeepSeek/Qwen）跑 **agent A/B**：同一组「跨边界 + 输出诚实度敏感」任务，A=有 OmniWeave、B=grep/LSP，量 **read 次数 / token / 误改**。
- [ ] 重点测**这一跑真正改的东西**：空/stale/ambiguous/large-repo 下，agent 是否**更少回退去 Read 整文件**、更少被竞品快照带偏。benchmark 测不到这层，A/B 才能。
- [ ] **诚实记录**：如果某些 commit 对 A/B 数字没贡献 → 写进 RESULTS，不粉饰。如果 daemon-skew 期间的旧 A/B 数据被污染过 → 标注作废。
- [ ] 产物落 `eval-results/agent-ab-2026-06-23/RESULTS.md`，对齐你已有的 round1–5 诚实边界格式。

**Done when**：有一组**新的、认证有效的** A/B 数字，能一句话回答「这一跑让 agent 在 X 类任务上少读 N 次 / 省 M token」；没动针的诚实标注「形态税不可降部分」。

### Phase 2 — form-factor 的真杠杆（按 eval 排序，逐项先 eval 后写）

你 eval 的结论是护城河在「努力/成本/token 随规模放大、模型越弱越宽」，且**固定 MCP/shape 税 ~34k 是 prompt 调不动的**。所以这里只碰**能压固定层**的东西：

1. **daemon/dist 自愈（分发可信度，强烈推荐先做）**：MCP server 启动 + 周期校验 dist 版本/构建指纹，发现源码已更新但实例旧 → 主动告警或自重启，而不是默默用旧逻辑骗 agent。这直接堵 Phase 0 抓到的「工具说谎」类问题，是「最可信」定位的硬支撑。
2. **固定 MCP/shape 税审计**：量当前默认工具面（5 工具 + server-instructions）实际占多少 prompt 固定开销，看能否在不损能力下再削（合并/精简 instructions/默认输出更紧）。**先用 token 计数证明有空间再动手**。
3. **明确 PARK（带证据，不是遗忘）**：在 CHECKPOINT 写清 `cross-process × 大仓 = NO-GO`（MAESTRO 1729 文件已平手）、`垂直 PR-review 闭环 = NO-GO`——避免下一个自主 loop 又把精力投进已证伪的方向。

**Done when**：daemon 不再可能静默用旧 dist；固定税要么被证明削减、要么诚实记录「不可降」；NO-GO 方向白纸黑字进 CHECKPOINT。

### Phase 3 — P2 semantic sidecar（只在 Phase 1/2 稳了之后，且先 eval）

严格按 super-goal 的护栏：**只做概念入口排序，绝不造 `calls/imports/overrides/crossLang/workflow` 任何结构边**；可取消、与核心图健康隔离。

- [ ] 先用 A/B 证明「概念查询时 sidecar 让 agent 第一次就读对文件、少一次错读」**确有收益**——没有收益就**不做**（奥卡姆：删掉它用户会变差吗？答否则删）。
- [ ] 若做，sidecar 物理隔离（独立可选索引），核心安装路径零膨胀。

**Done when**：要么有 red→green eval 证明 sidecar 降 agent 成本、要么明确判 NO-GO 并记录。

### Phase 4 — 流程修正（防止下一个自主 loop 再漂移）

- [ ] 给长目标加一条**自我节流闸**：每 N 个 commit（如 10）或每 M 个 turn，**强制重跑 benchmark + A/B**，针没动就停下来换方向，而不是继续 micro-hardening。把这条写进 `NEXT_SESSION_SUPER_GOAL.md` 的「Evaluation gates」。
- [ ] 把「daemon 重启 / dist 刷新」写进自主跑的标准收尾步骤，避免再出现「工具对自己说谎」一整段会话。

---

## 6. 风险与红线（保持你的 taste）

- **不 push 不发外**：Phase 0 的 push 等你明确点头；upstream 永不碰。
- **不无证据加 edge/能力**：Phase 2/3 一律先 eval 后写，符合「无 eval 不加 edge kind」。
- **不堆工具/不进向量当结构事实**：semantic sidecar 只排序不造边。
- **克制优先**：每个新增先问「删掉它 agent 会变差吗」，答否即删。
- **诚实优先**：A/B 没动针就如实写，不把 70 commit 包装成「能力跃迁」。

---

## 7. 新会话操作契约（Operating contract — 给下一个无人值守自主会话）

> 这是 `NEXT-SESSION-GOAL` 指向的权威细节。新会话**先读本节**，再读 §5 计划。

### 7.1 Push 策略（用户 2026-06-23 拍板：先推现有、之后只 commit）

- 积压的 **71 个 commit 已在本会话推到 `origin/main`**（`ec6d0eb..b246dae`），工作已保命。
- **新会话期间：只 `git commit`（有改动就提，小步、英文 message、绝无 AI 署名/trailer），不 `push`。** 增量留给用户回来手动推。
- 永远 `origin`，**绝不 `upstream`**；**绝不 `--force`** 到 main。

### 7.2 Phase 0 当前状态（本会话已做掉一半）

- [x] 提交未交付的 snapshot 图文本注入防御尾巴（`b246dae`）。
- [x] 推送积压 71 commit 到 `origin/main`。
- [ ] **刷新 MCP daemon**：杀旧常驻进程，让 MCP 实例吃新 dist，验证 `omniweave_explore` 不再报 `isLowSignalSourceQuery`。（新会话开场第一件事，否则工具会对你说谎）
- [ ] **同步文档数字**：跑一次全量 `npx vitest run` 取真数，更新 CHECKPOINT.md / README.md 的 test count（当前记的 1647 已严重滞后，真实 ≈1719）。

### 7.3 自我节流闸（防止再漂移成 micro-hardening）

- 每完成一个 Phase、或每 ~10 个 commit，**强制重跑** `npm run benchmark` + 一组 agent A/B；**北极星针没动就停下来换方向**，不要继续封边际收益递减的低信号口子。
- 每段自主跑的**标准收尾**包含「刷新 daemon / 校验 dist 指纹」，避免再出现「工具用旧 dist 对用户说谎」一整段会话。

### 7.4 已证伪、明确 PARK 的方向（带证据，别再投入）

- `cross-process × 大仓 = NO-GO`：小仓跨进程赢是「小仓现象」，大仓蒸发（MAESTRO 1729 文件已平手）。
- `垂直 PR-review 闭环 = NO-GO`（A/B round5 结论）。
- 任何「砸能力」的扩张在没有新 A/B 证据前一律先 PARK；护城河在「形态/固定税/输出精度」，且随仓库规模与模型变弱而放大。

---

## 附：本复盘的证据出处

- 会话提取：user turns + thread goal + 43 turn 末尾汇总 + 全部 subagent_notification（脚本提取自原始 jsonl）。
- 实测：`npm run build` / focused `vitest` / `npm run benchmark` / `git rev-list --count` 均在 2026-06-23 本机当场跑出，结果见 §3。
- 既有先验：`NEXT_SESSION_SUPER_GOAL.md`、`CHECKPOINT.md`、memory `omniweave-agent-ab-eval`（round1–5 / FINAL-REC v2）。
