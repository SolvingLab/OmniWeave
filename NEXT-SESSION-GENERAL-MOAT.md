# NEXT-SESSION — OmniWeave 通用护城河作战手册（新会话唯一权威·必读·极度完美化）

> 新会话**无上一会话记忆**。本文是唯一权威交接，一切以**真源码 + 真命令输出**为准，不信 README/记忆。
> 配套读：`CLAUDE.md`+`AGENTS.md`《工程交付强制规范》§0–§10、`CHECKPOINT.md`（当前进度+PARK 表，无新 A/B 不许重开 PARK 方向）、
> `eval-results/{lang-parity,adversarial-synthesizer,framework-parity,content-fts,content-vs-structural,general-moat,raison-detre}-2026-06-24/`、
> memory（`omniweave-general-moat` / `omniweave-vs-codegraph` / `omniweave-agent-ab-eval` / `omniweave-stepA-content-vs-structural`）。

## 0. 头号命题（用户拍板·灵魂·野心极大）
让 OmniWeave（OW）**通用替换 codegraph（CG）**。诚实概率：替换所有人 10–20% / polyglot+workflow 最佳 + 唯一带内容索引的结构图 60–70%。
**赌注两件**：① 成为「**唯一融合 内容检索 + 结构图 + 跨边界边 + 诚实输出 的本地零配置工具**」——护城河锚**融合 + 跨边界边(独家) + 零配置 + 努力/可达性/信任**，**不锚 grep 速度、绝不锚 correctness（永远平手，绝不宣称更正确）**。② 还「OW 不弱于 CG」的债（铁律⑥）。

## 1. 已完成（别重做，全已 commit、门禁绿、无 AI 署名；细节见 CHECKPOINT 顶部 2026-06-24 条目）
- **框架 synthesizer 债 8/8 还清**：celery/spring-event/mediatr/sidekiq/laravel/redux-thunk/c-fnptr/**rtkQuery**（含两层抽取 port）。dispatch-parity harness **6/6 OW≥CG**（`eval-results/framework-parity-2026-06-24/measure-dispatch.mjs` fail-closed）。
- **OW 成真·超集**：`moduleVarReferenceEdges`（same-file function→module 常量引用，impact 分析刚需）→ lang-parity **first-party OW≥CG 处处**（aider+10/code-graph-mcp+66/semantic-search-mcp+27），干净仓 raw 也赢。aider raw 残余 −142 = **唯一** CG minified-JS 假阳性（匹配=伪造错边，拒）。`lang-parity.sh` 已加 `ow_edges_fp/cg_edges_fp/fp_diff`。证据 `eval-results/lang-parity-2026-06-24/`。
- **Step A 决定性 A/B**（真 MiMo）：内容索引是 economy 非 outcome → 60–70 路线。**Step C content_fts** 落地：覆盖 docs/i18n、secrets 门控、`pattern:` CLI+MCP 可答 Q7、存储 1.49×。
- **对抗自证**：synthesizer false-positive battery **6/6** + module-var-ref 对抗 **6/6**（`eval-results/adversarial-synthesizer-2026-06-24/`）。
- **全 gate 绿**：build / test:unit 1846 / mcp-daemon 10/10 / eval 10/10+9/9 / benchmark 5/1/1 / dispatch-parity 6/6。

## 2. 剩余工作 / 下一步（按优先级；每项都要走「红→绿 + 论文级 artifact + 对抗证伪 + agent A/B」）
1. **Step D 输出经济（白送通用杠杆，主线）**：每条边都标 provenance/confidence（不止 synthesized）；`explore` 加 **metadata-only 模式**（零 token 结构预览）；确定性工具排序保 KV-cache。全在 `context/formatter.ts`+`mcp/tools.ts`，通用便宜。
2. **新边的 agent A/B（未过 A/B 不算能力·铁律）**：module-var-ref + rtkQuery + 8 个 dispatch synthesizer **存在 ≠ 有用**。必须真 MiMo agent A/B 证明它们让 agent 少 Read/少 turn（题库含 tie/no-help/ceiling，fail-closed，`scripts/agent-eval/`）。**这是最大未证项。**
3. **lang-parity 全语料复测**：本会话只跑了 3 仓。跑 `lang-parity.sh` 全 14 语言真实仓，确认 OW≥CG（first-party）处处、无回归。注意 memory `omniweave-vs-codegraph` 记的 **Swift −715/Kotlin −429 node 抽取 gap 仍开**——查是否真缺、能否补。
4. **module-var-ref 性能**：O(files×functions×modulevars×bodysize)，大仓（vscode 级 ~10k 文件）查 P95，必要时加 cap / 索引。
5. **优化/重构方向**（发现的债）：① `callback-synthesizer.ts` 已 3800+ 行——按 family 拆成 per-file（c-fnptr/goframe 已独立），但注意 §4 涟漪 6 处。② merged dedup 是 **kind-blind**（`source>target`），我 module-var-ref 用单独 insert 绕开了——更干净是改 dedup 键为 `(source,target,kind)`。③ OW 索引 minified bundle（asciinema-player.min.js ~185 噪声节点）——是否该 index 时跳 generated/minified？产品决策，需想清楚（更干净 vs 完整性）。
6. **benchmark v3 多样 agent A/B 未跑完**（`benchmark-questions-v3.json` GT/grader 就绪）。

## 3. 法则 / taste / 标准（违反=失信，逐条遵守）
**10 条铁律**：①证据优先 ②真实优先于 mock（agent A/B 用真 MiMo，`~/Desktop/本机AI-API资源盘点.md`，**key 绝不进任何文件/commit/日志**）③ultracode：实质任务 Workflow 并行 + **skeptic 默认证伪每条 win** ④题库**必含 tie/no-help/ceiling**，只挑 win=cherry-pick=失信 ⑤**绝不宣称「更正确」** ⑥**OW 绝不弱于 CG**，任何抽取改动后跑 `lang-parity.sh` 复测 ⑦commit 只描述改动**绝不加 AI 署名**（连产品名都不行，**自查 grep**）；push 只 origin 不 upstream 不 force main；**只在用户明确要求时 commit**（loop 内 checkpoint commit 已授权）⑧改 CLAUDE.md 必同步 AGENTS.md（`diff <(tail -n+12 CLAUDE.md) <(tail -n+12 AGENTS.md)` 必空）⑨daemon-skew 先疑旧 daemon ⑩别用 LANG 当 shell 变量；满载别跑全套件（flake，mcp-daemon 单独跑）；批判 Workflow 高负载卡死（TaskStop 杀+自己干）。
**taste**：**极度完美化（不惜 token/时间/改多少代码，"差不多"=失信）**；奥卡姆/极简/性能即设计/冰山/**错边比漏边**/多工具比少工具危险/未过 eval-A/B 不算能力/**评测产物=论文级可复现 artifact**（数据集 pin commit、GT 逐题可核、harness fail-closed、干净论文式目录）/**personal-domain 效用 ≠ 通用护城河（绝不混淆）**。
**本会话用户新增 4 条 taste（务必继承）**：① 题没区分度=题垃圾（设计判别性题）② content_fts 覆盖「所有文本文件」③ **哪怕是 OW 的优势也要疯狂质疑、不断出难题为难它**（对抗优先）④ **站 agent 角度判：多出的边有用不？有用一定要干过 CG；没用 OW 才该拒绝**（agent-usefulness test 决定建不建，不是为凑数字）。

## 4. 本会话发现的坑（新会话必踩，先记住）
- **daemon-skew（⑨）**：rebuild 后旧 MCP daemon 服旧 dist。验前 `pkill -f 'serve --mcp'`。
- **in-place 旧索引 skew（本会话新发现，关键）**：`init` 见源文件 hash 未变就 no-op，**即使 OW 代码(dist)变了也不重索引** → lang-parity/任何抽取验证前**必须 `rm -rf <repo>/.omniweave <repo>/.codegraph`**，否则测到旧图。
- **test flake**：满载下 1 个 timing-sensitive 测试会假失败，重跑即绿（别误判回归）。
- **并行流**：本仓可能有 auto-commit hook + 并行 agent 实时编辑 src 并用宽 `git add` 提交（会扫走你 uncommitted 改动）。见陌生 commit 先疑它；**验门禁用 git worktree 隔离已提交 HEAD**（symlink node_modules），别碰其 live 文件；commit 用显式路径。
- **lang-parity raw 计数误导**：CG 把 minified 单字母调用误解析成假阳性，raw 计数把它当「CG 赢」。用 `fp_diff`（first-party）判。

## 5. 资源 / 门禁 / 证据
- **门禁**：`npm run build`；`npm test`（two-phase，**mcp-daemon 单独/clean 跑**）；eval `EVAL_CORPUS=capstone EVAL_CODEBASE=__tests__/fixtures/capstone npx tsx __tests__/evaluation/runner.ts`（10/10）+ polyglot（9/9）；`npm run benchmark`（5/1/1）；`lang-parity.sh`（first-party OW≥CG，CG dist 在 `research/2026-06-23-codegraph-ecosystem/repos/codegraph/dist/bin/codegraph.js`）；dispatch-parity `node eval-results/framework-parity-2026-06-24/measure-dispatch.mjs`（6/6）。
- **真 LLM**：`~/Desktop/本机AI-API资源盘点.md`（MiMo 主力，绝不入库）。

## 6. DONE（super-perfect，全满足才停 loop）
① Step D 输出经济落地（provenance/confidence 全边 + metadata-only explore + 确定性排序）+ 论文级 artifact ② 新边（module-var-ref/rtkQuery/8 dispatch）有真 MiMo agent A/B 证据证明 agent ROI（少 Read/turn/token，含 tie/no-help/ceiling，fail-closed）③ lang-parity 全语料 first-party OW≥CG 处处 + Swift/Kotlin node gap 查清 ④ build/test:unit/mcp-daemon 10/10/eval 10-10+9-9/benchmark 5-1-1 全绿 ⑤ 死代码/不诚实输出清零、§9 七问过、发现的重构债（callback-synth 拆分/dedup 键/minified 索引）评估并记录处置 ⑥ 文档与真值同步、CLAUDE↔AGENTS 同步、memory 更新。每轮 loop 末尾跑 verify 门禁 + 把进度/新证据/下一步写进 CHECKPOINT 并 commit checkpoint（无 AI 署名）。**未达任一项即继续 loop，绝不「差不多」。**
