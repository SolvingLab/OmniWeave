# NEXT-SESSION — OmniWeave 通用护城河作战手册（新会话唯一权威·必读）

> 新会话**无上一会话记忆**。本文是唯一权威交接。一切以**真源码 + 真命令输出**为准，不信 README/记忆。
> 配套读：`CLAUDE.md`+`AGENTS.md`《工程交付强制规范》§0–§10、`CHECKPOINT.md`（PARK 表无新 A/B 不许重开）、
> `eval-results/general-moat-2026-06-24/`（**本命题的完整研究+对抗证据**）、`eval-results/raison-detre-2026-06-24/`（前序存在主义答卷）。

## 0. 头号命题（用户 2026-06-24 拍板·下一会话的灵魂）

用户**野心极大**：让 OmniWeave 最终**通用替换 codegraph（CG）**，不止 bio niche。诚实概率：「替换所有人」≈10–20%，「polyglot/workflow 最佳 + 唯一带内容索引的结构图」≈60–70%。**赌注（用户已批准）押在两件事**：
1. **成为「唯一融合 内容检索 + 结构图 + 跨边界边 + 诚实输出 的本地零配置工具」**（grep+graph 的超集装进一个 node:sqlite 索引）。护城河锚**融合 + 跨边界边(独家) + 零配置**，**不锚 grep 速度**（拼不过 flashgrep/Zoekt，也不用拼），**绝不锚 correctness**（永远平手）。
2. **先还「OW 不弱于 CG」的债**（铁律⑥）——本会话亲验 OW **真的弱于 CG**（见 §3）。

**做法**：ultracode 起 Workflow 多视角 + 对抗 skeptic 默认证伪每条 win；token 不是约束，完整正确才是。结论可复现落 `eval-results/`。**详细战略 + 构建顺序 + 诚实 caveat 见 `eval-results/general-moat-2026-06-24/README.md §0/§4`——那是行动蓝本。**

## 1. 战略构建顺序（`general-moat-2026-06-24/README.md §4`，每步带门禁）

- **Step A（先做！建索引之前）— 决定性 A/B**：5 真实仓（TS monorepo 5k+/Django/Spring/nf-core Snakemake/混合 C+Python）× 10 题（5 结构 + 5 内容，内容题**半字面半 regex**）× 3 臂（结构-only-OW+Bash/grep、CG、grep+Read）× 真 LLM（MiMo）× natural+forced × fail-closed。**判**：agent 用「结构 OW + Bash」是真**失败/退化**（→内容索引有 outcome 价值，10–20% 路线），还是只多花 ~1 工具调用（→只是经济价值，60–70% 路线）。**用数字决定，不用希望。绝不宣称 correctness win。**
- **Step B — 还框架 synthesizer 债（铁律⑥）**：port CG 的 pinia/vuex/redux/rtk/MediatR/celery/sidekiq/laravel/spring-event/c-fnptr/goframe 合成（CG 源 `research/2026-06-23-codegraph-ecosystem/repos/codegraph/src/resolution/{callback-synthesizer.ts,c-fnptr-synthesizer.ts,goframe-synthesizer.ts}`）。逐个带红→绿 eval fixture（真框架 app）+ `eval-results/omniweave-benchmark/harness/lang-parity.sh` 复测。门禁：OW≥CG 框架 app 边数。
- **Step C — `content_fts` trigram 内容索引（唯一新通用杠杆）**：`CREATE VIRTUAL TABLE content_fts USING fts5(path UNINDEXED, content, tokenize='trigram')`，`indexAll` 里对 ≤`MAX_FILE_SIZE` 文件填充。暴露为 `omniweave_search` 的 **`pattern:` 模式**（`query:` 保留符号 BM25）+ explore 空 seed 兜底。**诚实 caveat 写进文档**：trigram 擅长字面子串、复杂 regex 退化、~3.3x 内容存储（5k/20k/50k 档测+报，<50k 仓 gate <1GB）、单写 WAL 建索引写压力须 benchmark（不得给 init 加 >~30s）。**不做新默认工具，不动 5 工具面。**
- **Step D — 输出经济（白送通用杠杆，源自 BitFun）**：每条边都标 provenance/confidence（不只 crossLang）；explore 加 metadata-only 模式（零 token 结构预览）；确定性工具排序保 KV-cache。全在 formatter，通用，便宜。
- **绝不做**：5→1 工具合并（违 shape-tax PARK，无新 OW A/B）；Claude-Code 专属 UserPromptSubmit hook（宿主专属，AGENTS.md 已覆盖；要做先 A/B）。

## 2. 用户的法则 / taste / 标准（违反=失信，逐条遵守）

**10 条铁律**：①证据优先（真命令/真源码，不信 README/记忆）②真实优先于 mock——agent A/B 用**真 LLM**（MiMo，`~/Desktop/本机AI-API资源盘点.md`，Anthropic 协议 env `ANTHROPIC_BASE_URL/_AUTH_TOKEN`，**绝不把 key 写进任何文件/commit/日志**）③ultracode：每实质任务 Workflow 并行+skeptic 默认证伪每条 win④多样题库**必含 tie/no-help/ceiling**，只挑 win=cherry-pick=失信⑤**绝不宣称「更正确」**，correctness 平手是常态，护城河锚努力/可达性/信任⑥**OW 绝不该弱于 CG**（superset fork 起码平局），**任何抽取改动后跑 `lang-parity.sh` 复测**⑦commit 只描述改动**绝不加 AI 署名**，且**commit message 不得出现 Claude/Anthropic/AI 任何字样**（连产品名"Claude Code"都不行，本会话踩过）；push 只 origin 绝不 upstream 不 force main；**只在用户明确要求时 commit/push**⑧改 CLAUDE.md 必同步 AGENTS.md（`diff <(tail -n+12 CLAUDE.md) <(tail -n+12 AGENTS.md)` 必须空）⑨daemon-skew 先疑旧 daemon，rebuild+重连⑩**别用 LANG 当 shell 变量**（污染 locale 害 node:sqlite segfault）；**满载别跑全套件**（flake）；**批判 Workflow 高负载会卡死**（TaskStop 杀+自己干）。

**taste**：极度完美化（不惜 token/时间/改多少代码，"差不多"=失信）；奥卡姆/极简/性能即设计/冰山/**错边比漏边**；**多工具比少工具危险**；**未过 eval/A/B 的能力不算能力**；**评测产物=论文级可复现 artifact**（数据集 MANIFEST+pin commit、GT 逐题可核、harness fail-closed、干净论文式目录、深度保留结果+测试代码）；用户未来要写论文。**personal/domain 效用 ≠ 可辩护通用护城河，二者绝不混淆**。

## 3. 本会话亲验的关键事实 / 发现的问题（新会话直接用）

- **OW 真的弱于 CG（铁律⑥被触）**：CG `callback-synthesizer.ts`(2751行) 有 pinia/vuex/redux/rtk/MediatR/celery/sidekiq/laravel/spring/c-fnptr/goframe 框架合成；OW(2126行,**−625**)**全无**，无 c-fnptr 文件。证据 `eval-results/general-moat-2026-06-24/framework-synthesizer-gap.txt`。→ Vue/React/.NET/Django/Rails/Laravel/Spring/C 通用仓 OW 图比 CG 残。这是 §3 旧悬案「std_diff 谁强谁弱」的答案：**OW 弱**。Step B 还债。
- **flashgrep 不可采用**：`wgqqqqq/flashgrep` v0.2.7 私有闭源 Rust 二进制（`gh api repos/wgqqqqq/flashgrep`→404，license 未知），法律上不能 wrap/分发。架构=sparse-ngram 倒排+Lucene 分段+JSON-RPC daemon（Cursor 式，36x@Chromium）。**同类开源可采用**：Zoekt(Apache)/ripgrep(MIT)/FTS5。
- **buildability 已亲证**：`node:sqlite` 22.x FTS5 `tokenize='trigram'` 可用（子串 MATCH 命中），内容索引能纯在现有引擎建，零新依赖、保 zero-config。
- **OW FTS5 现状**：`nodes_fts` 只索引符号元数据(name/qualified_name/docstring/signature)，**不索引文件内容**；CG 同。这是 Q7 全文检索 grep 赢的根因，也是唯一不拥挤的通用空白。
- **value-reference 决策=DEFER**：上一会话遗留的 Ruby 常量读取 `references` 边 WIP 已存补丁 `eval-results/value-ref-decision-2026-06-24/ruby-value-ref.patch`（`git apply --check` 通过），未上（same-lang 标准边非 OW 护城河、Ruby-only 破坏一致性、需跨语言 A/B）。
- **并行开发流**：本会话期间有**并行进程（疑用户/另一 agent + auto-commit hook）实时编辑 src/mcp/tools.ts、sync/watcher 等并自动提交**（CLI/MCP 续跳 parity、node trails、watcher 隔离、snapshot 省略系列）。**新会话若见陌生改动/陌生 commit，先疑此并行流，别误判为自己回归**；要验门禁用 **git worktree 隔离已提交 HEAD**（symlink node_modules），别碰其 live 文件。

## 4. 本会话已完成（**别重做**，全已 commit、门禁绿、无 AI 署名）

- 存在主义命题答卷 `eval-results/raison-detre-2026-06-24/{README,debate.md,probe-build-orchestration.sh,build-orchestration-scan.txt,parity-recheck-post-deadcode.jsonl}`（裁定 b+c、niche、无通用 moat、6 条非-claim、build-orchestration pilot defer）。
- 死代码清除 commit `02b29b7`（~10 死符号：formatter formatSubgraphTree/formatNodeTree/truncate/formatBytes、migrations needsMigration/getMigrationHistory、import-resolver clearImportMappingCache+孤儿 importMappingCache、grammars isGrammarsInitialized/getLanguageDisplayName；tsc noUnusedLocals 兜底）。
- §6 lang-parity 复测 commit `06124ab`（lang-c/go/php/ruby 节点逐字等于基线，OW≥CG）。
- worktree 隔离全套件验证 commit `ebad808`（已提交 HEAD test:unit **1769 passed|0 failed**、mcp-daemon 10/10）。
- 通用护城河战略 commit `5061108` = `eval-results/general-moat-2026-06-24/{README,workflow-research-raw.json,framework-synthesizer-gap.txt}`（本手册 §0–§3 的完整证据源）。

## 5. 关键资源 / 门禁

- **门禁**：`npm run build`（指纹）；`npm test`=two-phase（`test:unit` 当前 ~1769 passed + `test:mcp-daemon` 10/10，**单独/clean 跑 daemon，满载会 ENOTEMPTY flake**）；eval `EVAL_CORPUS=capstone EVAL_CODEBASE=__tests__/fixtures/capstone npx tsx __tests__/evaluation/runner.ts`（10/10）+ polyglot-subprocess（9/9）；`npm run benchmark`（5 wins/1 tied/1 grep）；`lang-parity.sh <repo-dirs>`（OW≥CG，CG dist 在 `research/.../codegraph/dist/bin/codegraph.js`）。
- **真 LLM**：`~/Desktop/本机AI-API资源盘点.md`（MiMo 主力，绝不入库）。
- **benchmark harness**：`scripts/agent-eval/{ab-benchmark.sh,lang-parity.sh,score-benchmark.mjs,benchmark-questions{,-v2,-v3}.json}`（fail-closed，工作目录 `.bench-out*`/`.parity-out` gitignore）。
- **未竟（次要）**：v3 多样 agent A/B 未跑完（`benchmark-questions-v3.json` GT/grader 就绪）；残余 parity 长尾（swift-7/c-4/ts-3 niche）；benchmark 更狠（更大仓/更多真不同模型家族）。

## 6. 每轮 loop 末尾

跑 verify 门禁 + 把进度/新证据/下一步写进 CHECKPOINT + commit checkpoint（无 AI 署名）。**不做「差不多」**；未达 super-perfect 即继续 loop。细节恒以本文 + `eval-results/general-moat-2026-06-24/` 为准。
