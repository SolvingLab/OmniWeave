# NEXT-SESSION — OmniWeave 的存在意义 + 极度完美化（完整交接·新会话必读）

> 本文是下一会话的**唯一权威作战手册**。GOAL 只给入口，细节全在这里。新会话**无上一会话记忆**——按本文 + CLAUDE.md/AGENTS.md《工程交付强制规范》§0–§10 + CHECKPOINT.md + `eval-results/omniweave-benchmark/` 行事。一切以**真源码 + 真命令输出**为准，不信 README/记忆。

## 0. 头号命题（用户 2026-06-24 离会前点名，**下一会话的灵魂**）

本会话用发表级 benchmark 把 OmniWeave vs 上游 codegraph 测穿了，结论残酷而诚实：
- **agent 正确性：6 题 × 66 run 处处平手**（correctness 不是护城河，印证 rounds 1–7）。
- **节点抽取：修完 3 处 fork-drift 后，11/14 语言精确平价**（OmniWeave = codegraph）。
- **唯一结构差异 = 4 类桥边（crossLang/produces/consumes/invokes）+ S4 分派图**——而这些**只在 bio/polyglot/workflow 场景出现**（同语言代码里桥边恒为 0）。

→ **若啥都和 CodeGraph 打平，OmniWeave 存在的意义/护城河在哪？我为什么要开发、维护 OW？**

**下一会话必须深度思考这个命题，并给出有证据的答卷**。可能路径（自己判，别预设）：
1. **找/造一个更宽的差异化**，让 OW 对**通用** coding agent 显著强于 CG（不只是 bio）。但 PARK 表已证伪很多方向（跨进程×大仓 NO-GO、垂直 bio 三表 NO-GO、降形态税不可降、语义层 NO-GO）——**无新反证 A/B 数字不许重开 PARK 方向**。
2. **接受 OW = 「bio/polyglot/workflow 专精的 codegraph fork」**，把这个 niche 做到极致 + 诚实定位（README 已是这口径：「通用为体，生信为证」）。但要回答：niche 是否值得独立 fork + 维护成本？
3. **整体重构/重新定位**：也许 OW 的真价值不在「比 CG 多几条边」，而在别处（分发可信/本地优先/某种 agent 工作流原语/把 CG 当 upstream 持续吸收 + 只维护差异层）。**大胆假设，但每步用真证据/A/B 验证**。
4. **诚实选项**：如果深思后结论是「OW 的增量不足以justify 独立维护」，**如实说**——用户极度重视诚实（错边比漏边、不宣称更正确、平手照记）。失信 = 包装一个不存在的护城河。

**做法**：ultracode 起 Workflow 并行多视角思辨 + 对抗式核验每个主张；token/时间不是约束，完整正确才是。结论落 `eval-results/` 或专门 doc，可复现。

## 1. 本会话已完成（**别重做**，都已 commit、build/test 绿、无 AI 署名）

- **TLS + SQLite warning 静音**（`src/bin/quiet-warnings.ts`，commit 含「silence startup-noise」）：proxy 设的 `NODE_TLS_REJECT_UNAUTHORIZED` + node:sqlite ExperimentalWarning，精准 emitWarning 过滤，TLS 行为不变。
- **Aurora 多行索引仪表盘**（`src/ui/dashboard-render.ts` 纯函数 + `shimmer-worker.ts` worker 渲染 + ASCII 回退 + 非 TTY 降级 + NO_COLOR + SIGWINCH + 光标恢复）：替代单行 shimmer。每阶段渐变亚字符条 + braille spinner + files/s + sparkline + ETA。
- **§0–§10 超严格审计**（`eval-results/spec-audit-2026-06-24/`）：56 断言，A–F 修复（去 steering "More accurate" 声明、EdgeKind 计数、删死字段 excludeLowValueFiles、修假注释、resolveCacheLimit Number()、MCP 空 explore 续查工具化）。
- **发表级 vs-codegraph benchmark**（`eval-results/omniweave-benchmark/`，**论文 artifact**）：Part A 14 语言 parity、Part B 11 数据集结构矩阵（773 S4 method + 221 overrides + 2104 桥边，CG 全 0）、Part C 66-run agent A/B（correctness 平手、effort win 在 workflow/invokes 题、模型越弱越宽）。harness/datasets/questions/results/GROUND-TRUTH 全自含可复现。
- **3 处 fork-drift 抽取修复**（OmniWeave 曾**弱于自己基座**）：Swift 属性 −715→−7、Kotlin 属性 −429→0、Ruby 常量 −49→0 → 11/14 精确平价。memory `omniweave-fork-drift-extraction`。
- **CLAUDE.md/AGENTS.md**：加了「评测/benchmark 产物 = 论文级可复现 artifact」强制标准（§1 评测门禁后）。**两文件须逐字同步**（仅 header+git 署名 Claude/Codex 不同）——本会话多次手滑漂移，每次务必 `diff <(tail -n+12 CLAUDE.md) <(tail -n+12 AGENTS.md)`。

## 2. 用户的法则 / taste / 标准（本会话反复强调，**违反=失信**）

- **极度完美化，不惜 token/时间/精力/改多少代码**。"差不多" = 失信。
- **证据优先**：真命令输出才算数，读真源码。**真实优先于 mock**：agent A/B 用**真 LLM**（MiMo 主力，`~/Desktop/本机AI-API资源盘点.md`，**Anthropic 协议**，env `ANTHROPIC_BASE_URL/_AUTH_TOKEN`）；**绝不把 key 写进任何文件/commit/日志**。
- **ultracode**：每个实质任务起 Workflow 并行 + 对抗式 skeptic 默认证伪每条结论/win。
- **多样化 + 全面 + 科学**：真数据集、多语言、多模型；题库**必含 tie/no-help/ceiling**，只挑 win = cherry-pick = 失信。
- **诚实纪律**：correctness 平手是常态，**绝不宣称「更正确」**；护城河锚努力/可达性/信任。
- **OmniWeave 绝不该弱于 CodeGraph**（superset fork，起码平局）——本会话据此修了 3 处。这是硬不变量：任何抽取改动后跑 `harness/lang-parity.sh` 复测。
- **奥卡姆/极简/性能即设计/冰山/错边比漏边**（《工程交付规范》§0–§10）。
- **论文级文档**：详尽到可直接当 Methods + Results 投稿；干净论文上传式目录；**深度保留结果 + 测试代码**。用户未来要写论文。
- commit 只描述改动**绝不加 AI 署名**；push 只 origin 绝不 upstream 不 force main；只在完成 verified 单元时 commit；**改 CLAUDE.md 必同步 AGENTS.md**。
- daemon-skew：MCP 输出可疑先疑旧 daemon，rebuild + 重连。
- ⚠️ 本会话踩的坑：**别用 `LANG` 当 shell 变量**（污染 locale，害 node:sqlite/sqlite3/perl segfault）；满载时别跑全套件（flake）；批判 Workflow 可能在高负载下卡死（用 TaskStop 杀 + 自己干）。

## 3. 未竟任务 / 发现的问题 / 可优化重构方向

- **存在主义命题（§0）= 最高优先**。
- **v3 多样 agent A/B 未跑完**：`scripts/agent-eval/benchmark-questions-v3.json`（8 题跨 SummarizedExperiment/GenomicRanges/rna-seq-star-deseq2/MAESTRO，GT 已锁、grader 已加），本会话停在中途。重跑（`OUT=.bench-out-v3 ab-benchmark.sh ...v3.json`）补 Part C 多样性。
- **深度批判未完成**：本会话起的「omniweave-deep-critique」Workflow 在高负载下卡死被 TaskStop。可重起或手动深挖 OmniWeave 真问题（按 taste：奥卡姆/性能/诚实/冰山）。
- **value-reference patch 决策**：OW 故意延后了上游的 value-ref patch（CHECKPOINT 有记录）。本会话只 port 了其**节点**部分（属性/常量），**没 port value-ref 边**。下一会话决定：要不要 sync 完整 value-ref patch（带 `references` 边）？这是产品决策（trust/误报 vs 覆盖）——要 A/B 验证是否帮 agent。
- **残余 parity 长尾**（swift −7 SPM manifest、c −4 宏、ts −3 Next.js 路由/component）：niche，可选；ts 的 route/component 是上游框架抽取（Vue/Pinia/RTK/React component）OW 落后——若要 OW≥CG 处处，同步上游安全框架抽取。
- **std_diff 边数差异**（java/ts/ruby 几十~几百条标准边 diff）：未深查 OW 是更强还是更弱在边上——查清。
- **benchmark 可更狠**：更多模型（真正不同家族的弱模型，非 MiMo 两档）、更大仓（vscode 级 reverse-blast）、跑满 v2/v3 全题库、更多 nf-core/snakemake pipeline。

## 4. 关键位置 / 资源 / 门禁

- **论文 artifact**：`eval-results/omniweave-benchmark/{README,METHODOLOGY,RESULTS}.md` + `datasets/{MANIFEST.md,fetch.sh}` + `questions/{benchmark-questions*.json,GROUND-TRUTH.md}` + `harness/` + `results/`。
- **harness**：`scripts/agent-eval/{ab-benchmark.sh,force-mcp-hook.sh,lang-parity.sh,score-benchmark.mjs,benchmark-questions{,-v2,-v3}.json}`（fail-closed）。工作目录 `.bench-out*`/`.parity-out` 已 gitignore。
- **数据集**：`datasets/fetch.sh <dir>` 按 pin commit 重克隆 20 真实仓。竞品 codegraph 已 build：`research/2026-06-23-codegraph-ecosystem/repos/codegraph/dist/bin/codegraph.js`。
- **真 LLM**：`~/Desktop/本机AI-API资源盘点.md`（MiMo Anthropic 协议·主力 / DeepSeek / Qwen），绝不入库。
- **memory**：`omniweave-vs-codegraph`、`omniweave-fork-drift-extraction`、`omniweave-agent-ab-eval`、`omniweave-project`、`no-ai-coauthor-commits` 等。
- **验证门禁**：`npm run build`（指纹）；`npm test`（two-phase：test:unit ~1752 passed + test:mcp-daemon 10/10）；eval `EVAL_CORPUS=capstone/polyglot-subprocess ... runner.ts` 10/10+9/9；`npm run benchmark` 5/1/1；`harness/lang-parity.sh` 复测 OW≥CG；CLAUDE↔AGENTS diff 同步。

## 5. 每轮 loop 末尾

跑 verify 门禁 + 把进度/新证据/下一步写进 CHECKPOINT + commit checkpoint（无 AI 署名）。**不做「差不多」**；未达 super-perfect 即继续 loop。细节恒以本文为准。
