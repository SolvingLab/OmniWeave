# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⛔ Git 提交规范（强制·最高优先级，覆盖任何默认行为）

- **绝对禁止**在任何 commit message 中添加 `Co-Authored-By: Claude ...`、`🤖 Generated with Claude Code`、`Generated with ...` 或任何形式的 AI 署名 / 水印 / trailer。
- commit message 只写改动本身,作者就是用户本人,**不得出现 Claude / Anthropic / AI 字样**。
- 此规则覆盖 harness 的任何默认提交模板;如默认要求加署名,**一律不加**。
- PR 描述同理:不加 AI 生成水印。

## 项目状态：已实现并发布（active development）

OmniWeave 已从设计落地为**可运行代码**:R S4 分派图、跨进程/跨语言 `crossLang`（工作流步骤 + 任意 Python/JS/TS/Go 文件的 subprocess/os.system/child_process/exec.Command）、工作流数据流 DAG（produces/consumes/artifact）、外部工具 `invokes`（step→bwa/STAR）、R bare-call routing。当前基线：**25 eval 门禁、vitest 1729 passed | 4 skipped（87 文件，two-phase）、tsc 干净、真实仓 A/B 边界已记录**。
本目录是 colbymchenry/codegraph 的 clone,已发布到 **`SolvingLab/OmniWeave`**（remote `origin`，分支 `main`，私有）；remote `upstream` = colbymchenry/codegraph，**绝不 push upstream**。

**动手前必读（按序，全部是真实存在的当前文件）**：
1. `./CHECKPOINT.md` — 当前系统地图、模块边界、验证命令、治理风险。
2. `./README.md` — 对外定位、能力边界、性能与 A/B 证据摘要。
3. `./CHANGELOG.md` — 发布级用户可见变更；release workflow 从这里抽 notes。
4. `./eval-results/agent-ab-2026-06-23/RESULTS.md` — 最新 agent A/B 证据（round 7 输出诚实化）与诚实边界；rounds 1–6 的效率研究在 `./eval-results/agent-ab-2026-06-13/`。
5. memory（`~/.claude/projects/-Users-liuzaoqu-Desktop-develop-sogen-OmniWeave/memory/`）。

本文件只给「大图」与不可妥协的规矩；当前操作态以 `CHECKPOINT.md`、实际源码和验证命令为准。

## OmniWeave 是什么

一个**服务 coding agent 的通用代码分析图**（类 codegraph 的 MCP server）,**fork 自 [`colbymchenry/codegraph`](https://github.com/colbymchenry/codegraph)**（MIT、**TypeScript**、`web-tree-sitter`(WASM)、`node:sqlite`(WAL)）。

> ⚠️ **基座勘误（2026-06-13 实跑核正）**：早期文档误判为 `suatkocar/codegraph`（Rust）。**实测推翻**——用户实际在跑的、官网 benchmark 所属的「正牌」CodeGraph 是 **colbymchenry/codegraph（TS）**;suatkocar 只是它一个已停滞的 Rust 衍生。凡涉及 Rust/cargo/`.scm`/`6 参数 extract_edges`/`properties` 列/`0.294-0.392 基线` 的旧表述**全部作废**。

**定位（别框窄）**：不是「生信工具」,是 **more general / stronger / more efficient** 的通用代码分析图。生信（R 的 S4/R6、Perl、Nextflow/Snakemake、工具/数据混编）是**滩头堡 + 压力测试**,不是产品边界——「通用为体,生信为证」。

## 命令（标准 npm/TypeScript 项目；源码运行 Node ≥22.5 才有 `node:sqlite`，发布 bundle 自带 Node）

- 构建：`npm run build`（`tsc` + copy-assets 拷 `schema.sql` 与 vendored `tree-sitter-*.wasm`，含 `tree-sitter-r.wasm` + `node scripts/gen-build-id.mjs` 盖 `dist/.build-id` 构建指纹，供 daemon-skew 检测）
- 测试：`npm test`（two-phase：`test:unit` + `test:mcp-daemon`，当前全量 1729 passed | 4 skipped；普通套件和真实 daemon 集成测试分阶段跑，避免进程型恢复用例与 parser worker 抢资源）。单文件用 `npx vitest run __tests__/<file>`。
- **eval（红→绿数字门禁）**：`EVAL_CORPUS=<tag> npm run eval <indexed-repo>`。受控 fixture（capstone / polyglot-subprocess）当门禁、真实仓当广度证据。**eval 不自动索引**——先 `cd <fixture> && node <repo>/dist/bin/omniweave.js init -i`。
- benchmark（§1.5 证值）：`npm run benchmark` → `__tests__/evaluation/capability-matrix.ts`，emit `results/capability-matrix.{md,json}`；`OW_REALCORPUS=1` 跑真实大仓附录。
- MCP / CLI：`node dist/bin/omniweave.js <cmd>`（bin = `omniweave`）——`serve --mcp`、`init -i`、`callers/callees/impact/explore/search/status`。
- **git：只在用户明确要求时 commit；推送只 `origin`（绝不 `upstream`）；commit/PR 绝不加 AI 署名（见顶部）。**

## 架构大图（继承 colbymchenry 分层,差异化往上叠）

```
extraction（WASM worker 池,每语言一个 TS LanguageExtractor + visitNode hook）
  → graph（node:sqlite + FTS5）→ resolution（name-matcher + import-resolver）→ mcp（默认 5 工具面 explore/node/search/callers/impact，callees/files/status 经 OMNIWEAVE_MCP_TOOLS opt-in）
```

- **加一门语言** = 写 `src/extraction/languages/<lang>.ts`（LanguageExtractor 配置 + `visitNode`）+ 在 `languages/index.ts` 注册 + 放 `tree-sitter-<lang>.wasm`。**手写 TS tree-walker,无 `.scm` 文件**。
- **OmniWeave 实际落地的层（比初版设计更 Occam，详见 CHECKPOINT）**：
  - **R S4 分派图**：`src/extraction/languages/r.ts`（`setMethod`→`method` 节点，dispatch 类编进 qualifiedName `Class::generic`）+ `src/resolution/callback-synthesizer.ts`（`rS4DispatchEdges`，**复用 `contains`/`overrides` 边，没新造 `operatesOn`/`dispatches`，也没建 `resolution/r.ts`**）。
  - **跨进程/跨语言 `crossLang` + 工作流 DAG + `invokes`**：`.smk/.nf/Snakefile` 直接 tag `'python'` 复用 grammar；`src/resolution/frameworks/workflow.ts`（步骤/artifact/tool 抽取）+ `callback-synthesizer.ts`（`workflowCrossLangEdges` / `generalCrossLangEdges`）。**没建 `src/dataflow/` 或独立 snakemake/nextflow extractor。**
  - **bare-call routing**：`src/resolution/name-matcher.ts`（R 同名 generic/构造函数调用高置信路由到 function）。
  - **领域包（`src/domain/` bio 三表）与语义层（`src/semantic/` LSP 兜顶）= 已评估为 NO-GO**（CHECKPOINT PARK 表，证据:真实流水线步骤名自文档 + S4 运行时分派 R-LSP 也解不了）——**不要建**，除非有新证据。
- **新 Edge/Node kind 涟漪 6 处**（加 kind 前先想清楚，优先复用）：`types.ts` union、`mcp/tools.ts` RANK_EDGES、`context/formatter.ts` significantEdges、`context/index.ts` recoveryKinds、`graph/traversal.ts` BRIDGE_EDGE_KINDS + callers/callees 边表。

## 必须知道的真实事实（实跑核验,别再踩这些坑）

> ⚠️ **下面前两条是 fork 时的「基线 gap」,现已由 Phase 1·A 解决**（DESeq2 `method` 0→15、S4 dispatch 图打通,见 CHECKPOINT）。保留作历史背景与「为什么这样设计」的依据,**别误读为当前状态**——当前态看 CHECKPOINT。其余条目（schema、抽取机理、性能继承点）仍是现行事实。

- **0.9.8 对 R 是 0**：bundle 无 `r.js`;索引 DESeq2 时 15 个 `.R` 全跳过,只抓 2 个 `.cpp`。R 抽取器是 main（未发布,issue #828）才有的。
- **main 有 R,但 S4 分派图为零**（DESeq2 实测，**基线**）：类 3/3✓、函数 186,但 **`method`=0、`operatesOn`=0、`extends`=0**,全图边只有 `calls/contains/imports`。`setMethod` 抽成孤立 `function`,不连类/泛型。R6/R5/ggproto 的 list 方法**已是** `method` 类型,**唯独 S4（Bioconductor 主导范式）没接住** → Phase 1 第一刀（已完成）。
- **抽取无 `.scm`,是手写 TS walker**：判别逻辑直接写 `r.ts` 的 `visitNode`;`operatesOn`/`dispatches` 走 `unresolved_refs` + 新 `resolution/r.ts` 同包名字解析。
- schema：`edges` 元数据列叫 **`metadata`**（JSON）、`provenance` 是**一等列**（直接复用,不用加表）;`kind` 自由文本（加 `method`/`operatesOn` 无需改枚举,落库即所写）。resolution 两段式:抽取 emit `unresolved_refs(reference_kind)` → `resolution/index.ts` 解析成 `edges`。`import-resolver` 扩展名表**无 `r`**、无 R 专属 resolver。
- **eval harness 已存在**（`npm run eval`,recall+MRR）→ 不用造 eval 子命令,只需扩 R/bio 用例。基座真实基线要用它自己 harness 在 R/bio 语料上重测（Phase 0 产出）。
- 性能继承点：WASM worker 每 250 文件回收（线性内存只增不减）、`PARSE_TIMEOUT_MS=10s`、`node:sqlite` WAL（读不阻塞写）、2s debounce watch + staleness banner。
- **daemon 可能服务旧代码（本仓最易踩的坑，两次「工具骗了我」皆出于此）**：长驻 MCP daemon 持有它启动时载入的 `dist`，`npm run build`（同版本号、新逻辑）后旧 daemon 会继续吐 rebuild 前的答案。现已用**构建指纹**（version + `dist` 内容哈希，`scripts/gen-build-id.mjs` 盖进 `dist/.build-id`）在 daemon↔proxy 握手时检测 skew，新客户端发现指纹不符即转 in-process 跑当前代码；无 `.build-id` 时退回纯 version 比对。**若 `omniweave_*` MCP 输出可疑/陌生 → 先疑旧 daemon，rebuild + 重连宿主，别先怀疑自己的查询。**

## 工作方式

- **看真实的东西**：任何结论必须读真实源码 / 跑真实命令,有输出才算数;不信 README、不凭记忆。（这条铁律这次直接救了项目——差点 fork 错仓库。）
- **分阶段、eval 数字门禁**：Phase 0 建基线 → Phase 1 两棒并行（A: S4 分派图 / B: 工作流数据流,各带独立门禁）→ Phase 2 收口缝合，每阶段不达标不进下一阶段。**原计划的 Phase 3 领域包 / Phase 4 语义精度已被 CHECKPOINT PARK 表判 NO-GO（带证据），不是现行进路**；当前主线是「降形态税 / 提输出精度 / 守分发可信」，别再朝领域包或语义层投。
- **诚实的天花板**：R 的 S4 运行时分派、NSE、environments 静态不可解——**只抽「声明」不抽「分派」**,每条推断边带 `provenance` + `confidence`,绝不给 agent 一条伪造的边。

---

# 工程交付强制规范（OmniWeave-native·代码锚定·零妥协）

> 本章是全局《工程交付强制规范》针对 OmniWeave 的**领域改写**（用户 2026-06-24 明确授权，非默认 UI/流式版；后续 `/init` 勿还原为通用版）。
> 产品面不是 UI，是 `ToolHandler.execute()` 返回的 markdown + SQLite 图事实。常量**锚名字不锚行号**（`tools.ts` 4000+ 行热文件，行号必漂且不可检测）；精确值以源码为单一真值，文档勿复刻会漂的整表。

## 0. 总纲

未达标 = 未完成，不得交付。**产品定义**：把仓库编成可遍历、可置信、可预算的结构图，让 agent 少工具调用、少 token、少回退 Read、少被错边/脏输出带偏。默认立场：能删则删，能并则并，能简则简。四条铁律：

- **错边比漏边危险**——静态不可解就 skip（`generalCrossLangEdges` 对 `{}/$` 运行时路径直接 continue），绝不给 agent 一条伪造的边。
- **多工具比少工具危险**——全量定义 8 个 MCP 工具，默认只 LIST 5 个（`DEFAULT_MCP_TOOLS`）。
- **未过 eval / agent A/B 的能力不算能力**。
- **不宣称「更正确」**——价值在努力与信任（工具数 / token / turn / 稳定性），不在答案对错。文档 / CHANGELOG / steering 一律不写「比 grep 更正确」。

## 1. 需求与决策（奥卡姆 = agent ROI）

新增任何项，三连问全否则删：删掉它，agent 的工具调用 / input token / 误判率会变差吗？跨边界可达性（`crossLang` / `invokes` / workflow DAG）会变差吗？维护者还读得懂 `ToolHandler` / `callback-synthesizer` 吗？

**评测门禁（硬，分级）**：

- 任意逻辑 → `npm run build`
- MCP/CLI/formatter → 聚焦 vitest + `cli-explore` / `explore-surface-parity`
- ranking/budget/截断 → `explore-output-budget` + `scripts/agent-eval/probe-explore.mjs`
- 新 edge kind → §4 涟漪 6 处 + eval fixture 红→绿
- 形态/诚实类 → agent A/B（`scripts/agent-eval/ab-sufficiency.sh`，**fail-closed**：auth/空 jsonl/非零退出标 INVALID 并 non-zero exit，禁止 fake `explore=0` 胜利）
- 分发/守护进程 → `build-fingerprint.test.ts` + `mcp-daemon.test.ts`

**查询形状决策**（代码 + A/B 合意）：大仓 reverse/impact → 省工具调用（`getExploreBudget` 随仓放大**调用次数**而非单响应体积）；跨进程静态可解析链 → 必有 `crossLang` + provenance；单点「X 在哪」→ 平手即可，勿堆形态税；概念「auth 在哪」→ 不做核心（无 vector 入图路径）；同语言且 LSP 在场 → 平手，不替代 tsserver/pyright。

## 2. Agent 输出面（文本即 UI，取代「视觉与交互」）

界面就是 tool result 文本，每轮须经得起 agent 与维护者逐行审视。

- **替代 Read**：`explore`/`node` 源码用 `<n>\t<line>` 行号格式，可直接 Edit；续跳 key 固定形状 `omniweave_node symbol="..." file="..." line=N`（`nodeContinuationKey`）。
- **空/失败必须成功形状**：空 `explore` = `No relevant code found` + `This is an empty retrieval result, not a tool failure.` + 4 条可执行续查（CLI 给 shell 命令、MCP 给工具名）；未索引项目 exit 0 + stdout 指引，非 stderr 硬错。
- **调用面诚实**：`callers`/`callees`/blast/Flow 只把 `CALL_SURFACE_EDGE_KINDS = {calls, crossLang, invokes, instantiates}` 算「调用」；`references`/`imports`/`returns`/`type_of` omit 并报 omitted 计数。列表截断必须 `showing X of Y` 真总数（`formatNodeList`），禁止 silent cap。
- **低信号过滤**：默认 explore 过滤 `research/*/repos/*` 竞品快照（`isRepositorySnapshotFile`），除非 query 命中 `isRepositorySnapshotQuery`（需 `research/external/vendor/...` 或 `repo snapshot` 复合词——**单 `snapshot` 不解锁**）；小仓 tier 硬丢 test/spec。
- **默认工具面不可膨胀**：`DEFAULT_MCP_TOOLS` 5 个（explore/node/search/callers/impact）；`<500` 文件小仓再收为 `TINY_REPO_CORE_TOOLS` 3 个（explore/search/node）；`callees`/`files`/`status` 仅 `OMNIWEAVE_MCP_TOOLS` opt-in（`callees` 注释明写 redundant）。禁止为对标他人「14 工具」而扩默认面；新能力优先塞进 `explore`/`node` 一跳上下文。

## 3. 上下文预算与 inline 纪律（取代「60fps 流式」）

Agent 上下文是滚动视口；纪律等价于 scroll anchoring：不抢视口、不溢出、不半截。

- **硬上限**（`src/mcp/tools.ts` 模块常量）：`EXPLORE_INLINE_HARD_CEILING = 25_000`（所有 wrapper 之后再裁）、`MAX_OUTPUT_LENGTH = 15_000`（非 explore 工具）、`MAX_INPUT_LENGTH = 10_000`、`MAX_PATH_LENGTH = 4_096`。
- **分 tier 预算**：`getExploreOutputBudget`（按仓规模 5 档）放宽 maxOutputChars / maxFiles / per-file，**且 per-file 单调不减**（不变量写在注释里）；小仓关关系区 + 硬丢低价值文件，大仓开关系区。`getExploreBudget` 控**调用次数**（1→5 随仓放大）：大仓加 call 次数，不加单次响应体积。**精确档值以函数为单一真值，勿在文档复刻整表（会漂、易抄错）。**
- **截断诚实**：`truncateExploreAtCompleteBoundary` 优先在完整 ```fenced``` 块边界切，退化到 section/header 边界（不是「只在围栏」）；超大单文件 → 诚实 window + `oversized source range omitted`，禁止「有标题无代码」；区分 `Candidate graph`（候选广度）vs `Source shown below`（实展示）。
- **stale 纪律**：stale banner 置顶，但磁盘源码块仍 re-read 当前字节；明示符号/边/行号可能滞后；watcher-less/cross-project 复用 `getChangedFiles()`（与 status 同源）；已删文件渲 `indexed but missing on disk` 占位，禁止假装图仍真。

## 4. 图与信任边界（核心差异化）

- **类型**（`src/types.ts`）：`EdgeKind` 16 值（contains/calls/imports/exports/extends/implements/references/type_of/returns/instantiates/overrides/decorates/crossLang/produces/consumes/invokes）；跨边界第一公民 = `BRIDGE_EDGE_KINDS = {crossLang, produces, consumes, invokes}`（`graph/traversal.ts`）；`provenance ∈ {tree-sitter, scip, heuristic}`。
- **置信分层（关键，别拍平）**：S4 分派（`rS4DispatchEdges`）是**确定性结构边**——`setMethod` 静态可证，发 `contains`/`overrides`，**不带 provenance/confidence**；跨进程子调用（`generalCrossLangEdges`）是**启发式**——发 `heuristic` + `metadata.synthesizedBy` + `confidence`（数组/shell 基线 0.85/0.8，插值路径 ≤0.7）。把所有合成边一律标 heuristic 是错的，会毁掉「确定的算确定、猜的才标 confidence」这套信任模型。
- **crossLang 合成门**：跳过 workflow 文件；`cleanScriptPath` 后含 `{}`/`$`（运行时路径）直接 continue；目标必须是**已索引的 file 节点**；每函数 fanOut < `MAX_CROSSLANG_PER_FN`（8）。
- **新 edge/node kind 涟漪 6 处**（优先复用，别新造）：`types.ts` union、`mcp/tools.ts`（`RANK_EDGES` 局部集 + `CALL_SURFACE_EDGE_KINDS` + 关系展示）、`context/formatter.ts` significantEdges、`context/index.ts` recoveryKinds、`graph/traversal.ts` `BRIDGE_EDGE_KINDS` + callers/callees 边表、eval fixture。
- **SCIP / snapshot / 语义边界**：SCIP 只读现成 `index.scip`（不跑 indexer），文件须在 `files` 表、语言匹配、stale hash 拒、malformed range 跳、诊断文本转义、impact 标 `[scip]`；snapshot import 走 staged verify（`integrity_check`/`foreign_key_check`/ghost-path 拒）、`validateSnapshotGraphText` 拒围栏/控制字符注入、拒导出进活动 `.omniweave`；核心图**无 embedding 入边路径**，sidecar（若做）只排序 seed，禁止写 calls/imports/overrides/crossLang/produces/consumes/invokes。

## 5. 性能与资源（索引硬约束）

- 抽取（`src/extraction/index.ts`）：`PARSE_TIMEOUT_MS = 10_000`（大文件 +10s/100KB）、`WORKER_RECYCLE_INTERVAL = 250`（WASM 线性堆不可 shrink，必须回收 worker）、`MAX_FILE_SIZE = 1 MiB`（`1024*1024`）跳过超大文件；默认 WASM worker 池，worker 缺失退 in-process（测试路径）。
- 资源边界：resolution `LRUCache` 有界（防大仓 OOM）；`node:sqlite` WAL（读不阻塞写）；跨进程 `FileLock` 活 PID 拒抢（不偷锁）；daemon 锁 atomic `link()`，`clearStaleDaemonLock` 仅清死 PID。
- 查询热路径禁止 O(repo) 重复全量解析；输入上限防滥用。交付须能说明：索引 N 文件 P95、单次 explore P95 字符、worker recycle 后 RSS、当前仓落在哪个 budget tier。

## 6. 分发可信度（运行实例不得说谎）

- `OmniWeaveBuildFingerprint = version + '+' + buildId`（buildId = `dist/.build-id` 内容哈希，`scripts/gen-build-id.mjs` 盖）；同版本 rebuild 必改指纹。
- proxy↔daemon 握手严格比对指纹，不符 → 转 in-process 直服当前代码；无 stamp（src 运行 / 旧装）降级 version-only。
- `npm run build` 后 daemon 仍服旧 dist = **产品级 bug**（本仓两次「工具骗了我」之源）。交付须 `build-fingerprint.test.ts` 绿 +「rebuild 后 explore 行为变化可感知」smoke。

## 7. 全局统一 & 代码标准

- 单一事实源 `ToolHandler`；CLI 与 MCP 同走 `execute`，仅 `outputSurface`（内部，不可被 MCP caller spoof）区分恢复文案。
- 数值契约：整数字符串全解析 + clamp（`Number()` 非 `parseInt`，`'2abc'→default` 而非 2；maxFiles 1–20）。
- 版本单一真相：`npm version = CHANGELOG = git tag = dist/.build-id 指纹`。
- ESM + strict + async/await，禁 `var`；命名即域语言（`crossLang`/`synthesizedBy`/`ExploreOutputBudget`）；命名即文档、结构即意图，读代码应像读 prose。
- 实现前必须覆盖的边界：未索引 / 空索引 / stale / git staged-delete 恢复、overload 同名 / monorepo 同名、symlink 逃逸（`validatePathWithinRoot`）、并发 sync/import/export 写锁、超大输入 / 恶意 MCP payload、daemon 死/活 PID 竞态。禁止交付无 provenance 的启发式边、无注释的非自明 ranking、隐式全局可变状态、仅为「能跑」的脆弱实现。

## 8. 冰山法则

表层：默认 3–5 个 LIST 工具 + 极简 CLI。底层：worker recycle、WAL、file lock、catch-up gate、snapshot verify、SCIP gate、fingerprint rendezvous、output-budget tier——默默托底且可被维护者读懂。改一处评十处（§4 涟漪 6 处是最小例：依赖方向、生命周期、边界必须清晰）。

## 9. 交付前强制验收（七问，任一否 = 禁止交付）

1. 空/宽查询是否仍倒竞品快照或 6K+ 噪声 token？
2. stale 是否让 agent 信任错误行号/边？
3. 是否有可删未删的工具 / 输出区块 / 边类型？
4. MCP 与 CLI 同一查询是否矛盾？
5. overload / 超大文件 / 跨 lang 是否仅 happy path？
6. 新人能否不看作者解释改 `tools.ts` + `formatter`？
7. rebuild 后 MCP 是否可能静默服务旧 dist？文档是否写清 win/tie/no-help、不宣称「更正确」？

## 10. 终极标准

「最好用」的可操作定义：unset allowlist 时 LIST ≤5（小仓 ≤3）；架构题 `explore` 一跳拿源码 + blast + 续跳 key；polyglot 上 `crossLang`/`invokes` 可遍历，且启发式边带 confidence、确定性边不带；`callers`/`impact` 报 `showing X of Y` 真总数；零配置 checkout 可索引可查；rebuild 后不静默服务旧 dist；证据在 `eval-results/` 可复现、harness fail-closed。

每一处取舍三连问：为什么这样写？为什么不再简（工具数 / 字符数 / 边数）？为什么这样让 agent 更快或更稳（探针或 A/B 数字）？

**未达标，不是「图还不够大」，而是 agent 仍多读、仍被带偏、仍不信输出、仍付多余形态税、或运行实例仍在说谎。对得起这条标准。未达标，不算交付完成。**
