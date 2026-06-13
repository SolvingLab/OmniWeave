# OmniWeave — 服务 coding agent 的通用代码分析图（设计方案 v2 · 已 rebase 到真实基座）

> **OmniWeave** —— *weave polyglot code into one graph*。接你的 OmniTools / OmniAtlas / OmniAnalysis 生态。
> 一句话定位：**一个 more general / stronger / more efficient 的代码分析图，服务 coding agent。**
> 生信不是产品边界——它是滩头堡与压力测试：能啃下 R 的 S4/R6 + Perl + Nextflow/Snakemake + 工具/数据混编这种最硬的 polyglot 场景，才证明引擎是真 general。
>
> **v2 勘误（关键）**：v1 把基座误判为 `suatkocar/codegraph`（Rust）。**实测推翻**：你机器上跑的、官网 benchmark 所属的「正牌」CodeGraph 是 **`colbymchenry/codegraph`（TypeScript）**，suatkocar 只是它一个**已停滞的 Rust 衍生改写**。本文每条技术事实均来自**真实源码 + 真实索引运行**（在 DESeq2 上实跑 main 构建产物，见 §0/§5/§11 的实测数字），不引 README、不凭记忆。

---

## 0. 一页纸结论

- **基座（已核正）**：fork [`colbymchenry/codegraph`](https://github.com/colbymchenry/codegraph) —— MIT、**TypeScript**、`web-tree-sitter`（WASM 语法）、`node:sqlite`（WAL）、MCP 原生、20+ 语言、14 框架路由、iOS/RN/Expo 跨语言桥接、活跃维护（Opus 4.8 实测 benchmark）。GitHub 开源含完整 TS 源（`src/`、`__tests__/`、`tsconfig`、`vitest`），**可 fork**；npm 只发编译产物。
- **真实基线（实测，非推测）**：
  - 你日用的发布版 **0.9.8 对 R 支持是 0**——bundle 内 18 个语言抽取器无 `r.js`；索引 DESeq2 时 **15 个 `.R` 全跳过**，只抓 2 个 `.cpp`。你的生信代码对当前 codegraph **是隐形的**。
  - fork 目标 `main`（→1.0.0）刚落地 R 抽取器（issue #828）。在 DESeq2 实跑：**R 声明抽取可用**（3/3 S4 类、186 函数、27 import），但 **S4 语义分派图完全为零**：`method` 节点 **0**、`operatesOn` **0**、`extends` **0**；全图边只有 `calls / contains / imports` 三种。`setMethod("results","DESeqDataSet",fn)` 被抽成一个**孤立的 `function`**，既不是方法、也不连到类。
- **三个通用能力拉开差距**（生信把它们压到极限，但每个都通用）：
  1. **多重分派语义图**——把 S4/R6 的「泛型 × 类 → 方法」做成**一等公民**（`method` 类型 + `operatesOn`/`dispatches` 边）。同构覆盖 Julia 多分派、C++ 重载、Go interface 实现。**目前无人把分派做成一等边**。
  2. **跨进程工作流数据流**——Nextflow/Snakemake/Make/CI 里**数据跨进程流动**（`produces/consumes/invokes/crossLang`）。colbymchenry 只桥**同进程跨语言调用**（Swift↔ObjC），**不追文件在 DAG 里跨进程流**。全行业空白。
  3. **可插拔领域包**——`EDAM`/`bio.tools`/`biocViews` = pack #1，内核永不认识「生信」三个字，只认「领域包」这一数据接口。
- **trust 是头部分水岭**：基座 `Edge.provenance` 三值 `tree-sitter`/`scip`/`heuristic`（**无 `static`/`lsp`**——勘误）。声明级确定边（如 S4 分派）省略 provenance（= 结构事实级）；启发式/低置信边标 `heuristic`，必要时把 `confidence` 放进 `Edge.metadata`（无一等列）。经 MCP 透传给 agent。**准 = 不给 agent 一条它以为可信、实则编造的边。**
- **门禁**：每阶段用 eval 数字卡死，不达标不进下一阶段。基座自带 eval harness（`npm run eval`），但用例是 Java/Elasticsearch；OmniWeave 首件事是把它换成 R/S4 + workflow 用例并量出真实基线。

---

## 1. 定位：通用为体，生信为证

| 三条命 | 落到设计的含义 | 打谁的痛点 |
|---|---|---|
| **more general** | 语言广度（含最难的 R/Perl/DSL）+ **边类型广度**（call/import 之外加分派、数据流、跨语言、跨进程）+ 可插拔领域包 | 现有工具只认主流语言、只有语法边 |
| **stronger** | 把语义关系（分派、数据流）做进图，而不止语法关系；**确定性抽取打底 + 语义层兜顶**；每条边可信、带 provenance | 现有工具同名即连边，agent 不敢信 |
| **more efficient** | 继承基座的 WASM worker 回收 + `node:sqlite` WAL + 增量 watch；**token 经济**（对 agent 的 context 也算高效，是基座 benchmark 的核心卖点） | 多数工具返回文件转储烧 context |

**为什么从生信切入而非主流软柿子**：主流语言（TS/Py/Go…）基座已做得很好，再卷边际收益低；生信是 polyglot + 科学计算的最硬骨头（S4 多分派、workflow 跨进程、工具/数据混编），啃下它，通用性自动成立，且占住最被忽视的市场。**反过来先做通用图，永远证明不了 general，还会被基座本体卷死。**

**与上游的关系（诚实）**：Phase 1 的 S4 分派图足够通用，价值清晰，**可顺手给 colbymchenry 提 PR**；OmniWeave 用 ②跨进程数据流 + ③领域包 + Perl + 语义层立自己的身份。fork 让我们在自己有主张的方向上快跑，不被上游 review 卡。

---

## 1.5 竞品定位与形态约束（2026-06-13 实证调研，含可复现 star 数）

> 这一节回答一个灵魂问题：**「codegraph 这么火（48k stars），为什么 Claude Code / opencode 这类顶级 agent 偏偏不内置它？」** 结论直接约束 OmniWeave 该做成什么形态——不是技术选型自由发挥，是被市场结构卡死的。

### 实测事实（gh api 实查，非记忆）
- `colbymchenry/codegraph` **48,310 stars，仍活跃**（≈ Aider 的 46k，同级顶流）；`suatkocar/codegraph`（那个 Rust 衍生）**9 stars，死的**；`BloopAI/bloop` 9.5k **已 archived**。→ codegraph 不是小众，是「明星但未被顶级 agent 内置」，所以原因是**架构/哲学**，不是没人知道。
- 厂商自报指标（Augment +70% / Cursor +12.5% / Tabnine +82%）**一律按广告打折**，无方法学、不可复现。下表只用「公开架构选择」+「一手设计理由陈述」两类可信证据。

### 市场分两派（分界线是商业形态，不是「图有没有用」）
| | **建索引派**（云 embedding / 企业护城河） | **不建索引派**（本地·模型优先·薄客户端） |
|---|---|---|
| 代表 | Cursor、GitHub Copilot、Augment、Sourcegraph、Tabnine、Windsurf | **Claude Code、Cline、opencode** |
| 索引形态 | 服务端持久索引；向量为主，Sourcegraph 已撤 embedding 改 **SCIP 结构图**，Augment 叠结构层 | **不建持久索引**；`grep/glob/read/lsp/task` 现拉现用 |
| 卖点 | 「能吃你的百万行 monorepo」——索引即收费理由 | 「任何 repo 零配置即开即用」——索引是**税** |
| codegraph 对它 | 形态不符（它们自研云索引，不接单人 daemon） | **哲学不符**（接 daemon 就是给「我不需要索引」拆台） |

一手理由（高可信，与其 grep-only 架构吻合）——Claude Code 作者 Boris Cherny：早期用过 RAG+本地向量库，**很快发现 agentic search 普遍更好，且更简单，没有安全/隐私/陈旧/可靠性那些问题**。

### codegraph/OmniWeave 卡在「尴尬中间地带」（必须正视）
1. **比 grep 重**：要建索引、要常驻、要保鲜（codegraph 自带 staleness banner 就证明「编辑后索引即脏」是真问题，而 agent 每秒改码）。
2. **语义召回不如向量**：tree-sitter 结构图做不了「概念性检索」，那是向量派的活。
3. **精确导航和 LSP 撞车**：opencode 的 `lsp` 工具已暴露 `incomingCalls/outgoingCalls/goToImplementation`——**codegraph 最招牌的调用图，LSP 已白嫖且编译器级精度**。
4. **按语言挑食**：per-语言抽取器，连 R/S4 都勉强、workflow 文件全无（Track A 亲历）。grep 吃一切。

### 决定性反例 = Aider（OmniWeave 必须学的甜点区）
Aider 同属「本地·模型优先」派，**却内置结构代码图**（tree-sitter 抽定义/引用 → 引用图 → **PageRank 排序** → 按 token 预算裁出最相关文件）。它被广泛采用，差别只在**形态**：**进程内、零配置、即时、按 mtime 缓存每次重建（永不"陈旧"）、token 预算感知、无向量库、无 daemon、无云**。→ 真相不是「这派不要图」，是「**只要 Aider 式进程内轻量图，不要 codegraph 式 daemon 图**」。

### 由此锁死的三条形态约束（约束 OmniWeave 后续所有决策）
1. **形态：优先「进程内/嵌入式查询」语义，而非重 daemon**。MCP server 可以是门面，但索引构建/读取要往「零配置、即时、按需重建、token 预算感知」靠（Aider 甜点区），不要往「常驻服务 + 手动保鲜」靠（Sourcegraph 重档）。staleness banner 是退路不是卖点。
2. **别和 LSP 撞车**：callers/callees/impl/定义/诊断是 LSP 的主场，OmniWeave **不靠重做它们取胜**。只赢在 LSP 结构上够不着的地方——**跨语言、跨进程、动态分派**（S4/interface/callback/workflow→脚本）。这正是 Track A（S4 分派）+ Track B（跨进程数据流）的方向，是唯一躲开撞车的活路。Phase 8 语义层是「**用** LSP 兜顶」，不是「**替** LSP」。
3. **按关系铺，不按语言铺**：通用性来自**边类型的广度**（分派/数据流/跨进程），不是再多堆几门主流语言的语法边（那是和基座本体内卷）。token 经济（少返回、返回准）= 这一派的硬通货，必须当一等指标。

### 诚实的怀疑（别被自己的调研带飞）
- **48k stars ≠ 日常 loop 承重**。star 是热度，Aider 的 46k 背后是成熟产品日活；codegraph 的 48k 是 5 个月 MCP 爆款，可能「star 完没跑第二次」。流行且真实，但**无证据证明它在谁的 agent 日常里是承重件**。
- 品类**活且在长**，但**分叉**（云向量企业 / 进程内结构轻量）；OmniWeave 血统属后者，价值要靠 eval 数字证明，不靠「图天然更好」的信仰。

---

## 2. 基座决策：为什么是 colbymchenry/codegraph（已逐文件 + 实跑核验）

| 维度 | 真实情况（核验来源：GitHub 源码树 + 本机 0.9.8 bundle + main 构建实跑） |
|---|---|
| License | **MIT**（`LICENSE`）→ 随便 fork、可商用、无 copyleft |
| 栈 | TypeScript（`tsc` 构建）；`web-tree-sitter ^0.25` + 自带 vendored `*.wasm` 语法（含 `tree-sitter-r.wasm`，tree-sitter-wasms 里没有 R，作者单独打包）；`node:sqlite`（WAL）；`chokidar` + 原生 FSEvents/inotify 监听；`commander` CLI；自带 Node 24 runtime（发布版 bundle，用户零依赖） |
| 体量/分层 | `src/{extraction/{languages/*.ts, grammars, tree-sitter, index}, resolution/{index, import-resolver, name-matcher, frameworks/*}, graph, db/{schema.sql,queries}, mcp, search, sync, context, telemetry, ui}`；`__tests__/`（vitest）+ `__tests__/evaluation/`（eval harness） |
| 加语言成本 | 写一个 `src/extraction/languages/<lang>.ts`（LanguageExtractor 配置对象，含 `visitNode` hook）+ 在 `languages/index.ts` 注册 + 放一个 `tree-sitter-<lang>.wasm`。**手写 TS tree-walker，无 `.scm` 文件**（见 §5.1） |
| 已索引语言 | TS/JS/Py/Go/Rust/Java/C#/PHP/Ruby/C/C++/ObjC/Swift/Kotlin/Scala/Dart/Svelte/Vue/Liquid/Pascal/Lua/Luau；**R 在 main 上刚加、未发布**；无 Perl/Nextflow/Snakemake |
| MCP | 原生 10 工具：`search/context/trace/callers/callees/impact/node/explore/files/status`；服务器自带 usage guidance（`initialize` 响应里下发，不写 CLAUDE.md） |
| 维护现状 | 活跃；官网/benchmark（25% 更省、62% 更少工具调用，Opus 4.8 复测）所属的本体 |

**为什么不选 Rust 系**：`suatkocar/codegraph`（Rust 衍生）已停滞（最后 push 2026-03-03）且 R/eval/provenance 全弱；`peterctwang/codegraph-rust` 较新但 R 深度不如本体。选 Rust 要先重建本体已有的 R+eval+20 语言+provenance，几个月后才开始差异化——离「全球第一」更远。**头部打法是站在最强本体上往语义层叠，而不是从弱基座重造轮子。**

---

## 3. 你免费继承 vs 必须自己造

**白嫖（production-ready，别重写）**：
- `node:sqlite`(WAL) 图存储 + FTS5 全文检索（`nodes_fts` 触发器同步）；
- `web-tree-sitter` 增量解析 + **WASM worker 线程池**（`WORKER_RECYCLE_INTERVAL=250` 文件回收，因 WASM 线性内存只增不减；`PARSE_TIMEOUT_MS=10s` 防挂死）；
- 原生文件监听 + 2s debounce 自动同步 + **per-file staleness banner**（编辑窗口内提示 agent 直接 Read）+ connect-time catch-up；
- resolution 框架：`name-matcher`（matchReference/matchFunctionRef/matchDottedCallChain/matchScopedCallChain + 语言族判定）+ per-language `import-resolver` + 14 框架路由 resolver + callback 合成器；
- **provenance 机制已存在**：跨语言桥接边已带 `provenance:'heuristic'` + `metadata.synthesizedBy`——OmniWeave 的「每条推断边带 provenance+confidence」直接复用这套；
- **eval harness 已存在**：`npm run eval` → `__tests__/evaluation/runner.ts`（recall + MRR，`PASS_THRESHOLD=0.5`，`EvalReport` 带 `codegraphSha`）。

**必须造（= 差异化所在，全部实测确认为真空）**：
- **S4 分派图**：`setMethod` 现在抽成孤立 `function`；缺 `method` 类型、缺 `operatesOn`（方法→类）、缺 `dispatches`（方法→泛型）。R6/R5/ggproto 的 list 方法已是 `method` 类型（`emitMethodArg`）但 **S4 ——Bioconductor 主导范式——完全没接住**。
- **R 跨文件/跨包解析**：`import-resolver.ts` 的 `EXTENSION_RESOLUTION` 有 ts/py/go/rust/java/c/cpp/php/ruby/objc，**唯独没 `r`**；resolution 编排里**无任何 R 专属 resolver**，R 引用只能走通用名字匹配。`source("x.R")`、`DESCRIPTION`/`NAMESPACE` 包边界——全无。
- **跨进程工作流数据流**：完全没有。
- **领域知识层**：完全没有。
- **语义精度层（LSP 兜顶）**：完全没有。

---

## 4. 架构总览（在 colbymchenry 之上分层）

```
                         ┌─────────────────────────────────────────────┐
   coding agent ──MCP──► │ MCP 工具面 src/mcp/  10 工具 + OmniWeave 新工具 │  好用
                         │           （token 预算 / provenance 透传）      │
                         └─────────────────────────────────────────────┘
  ④ Stronger 语义层 ───► │ src/semantic/   按需 LSP 消歧（最后实现，离热路径） │
  ③ 领域包   pack ─────► │ src/domain/     EDAM/bio.tools 识别器（数据驱动）   │
  ② 数据流   edges ────► │ src/dataflow/   workflow → produces/consumes/crossLang │
  ① 深抽取   nodes ────► │ src/extraction/languages/r.ts（增 S4 分派）+ resolution/r.ts │
                         ┌─────────────────────────────────────────────┐
   继承（不动地基）       │ extraction(WASM worker) → graph(node:sqlite) → resolution → mcp │
                         └─────────────────────────────────────────────┘
```

**实测校正过的内部事实**（写代码前必须用这些，全部来自真实源码/运行）：
- **抽取是手写 TS tree-walker，无 `.scm`**：每语言一个 `LanguageExtractor`（node-type 列表 + `visitNode(node, ctx)` hook）。R（`r.ts`）因「R 一切皆表达式」**全走 `visitNode`**（`functionTypes` 等列表全空）。→ v1 关于「`.scm` 谓词失效」的整段**作废**（那是 Rust 基座的问题，TS 基座根本没有 `.scm`）。
- **`ExtractorContext` API**（Phase 1 落点）：`ctx.createNode(kind, name, node, {signature?})`、`ctx.addUnresolvedReference({fromNodeId, referenceName, referenceKind, line, column})`、`ctx.pushScope(id)/popScope()`、`ctx.visitNode(child)`、`ctx.nodeStack`、`ctx.source`。
- **schema（`src/db/schema.sql`）**：`nodes(id, kind, name, qualified_name, file_path, language, start/end_line/column, docstring, signature, visibility, is_exported, return_type, ...)`；`edges(id, source, target, kind, **metadata** JSON, line, col, **provenance** DEFAULT NULL, FK ON DELETE CASCADE)`；`unresolved_refs(from_node_id, reference_name, reference_kind, candidates JSON, file_path, language)`；FTS5 `nodes_fts`。→ 元数据列叫 **`metadata`**、provenance 是**一等列**（v1 说的 `properties` 是 Rust 基座的，作废）。
- **`kind` 是自由文本**：新增 `method`/`operatesOn` 之类无需改枚举——直接写字符串（落库即所写，无 snake_case 转换层）。
- **resolution 两段式**：抽取期 emit `unresolved_refs`（带 `reference_kind`）→ 索引后 `resolution/index.ts` 用 name-matcher + import-resolver 把它们解析成 `edges`。**OmniWeave 的 `operatesOn`/`dispatches` 就走这条缝**：r.ts emit `reference_kind:'operatesOn'/'dispatches'` 的 unresolved_ref，新增 `resolution/r.ts` 在同包命名空间内按名匹配到 class/generic 节点。

---

## 5. 通用能力①：多重分派语义图（R 作参考实现）

### 5.1 实测 gap（DESeq2，main 构建，全是真跑出来的数字）
DESeq2 源码真实 S4 面：`setClass × 3`、`setGeneric × 8`、`setMethod × 15`、`setValidity × 1`。抽取结果：

| 期望 | 实测 |
|---|---|
| 3 个类 | ✅ `DESeqDataSet / DESeqResults / DESeqTransform` |
| `method` 节点 ≥15 | ❌ **0**（15 个 setMethod 全成孤立 `function`） |
| `operatesOn`（方法→类） | ❌ **0** |
| `dispatches`（方法→泛型） | ❌ **0**（8 泛型 + 15 方法 = 23 个互不相连的函数） |
| `extends`（继承） | ❌ **0**（继承到 `SummarizedExperiment`/`DataFrame` 等 Bioc 基类全隐形） |

**关键洞察**：R6/R5/ggproto 的 list 方法**已经**是 `method` 类型（`r.ts: emitMethodArg`），但 **S4 `setMethod` 路径只 `createNode('function', …)`**——而 S4 正是 Bioconductor 的主导范式。这就是第一刀的精确落点。

### 5.2 Phase 1·Track A：S4/R6 分派外科手术

> ✅ **AS-BUILT（2026-06-13 已完成并全验证，本节实际落地版，取代下方初版草图）**：详见 `OmniWeave-STATUS.md §0.5`。要点：**不新造 `operatesOn`/`dispatches` 边**，复用既有 EdgeKind——`contains`（class→method）+ `overrides`（method→generic，原已声明却未 emit）。dispatch 类编进 method 的 **qualifiedName=`Class::generic`**（Go `Recv::name` 同款），由 `resolution/callback-synthesizer.ts` 的新 `rS4DispatchEdges`（结构同构 `goCrossFileMethodContainsEdges`）同目录(=R 包)按名解析两边——**无新 resolver 文件、无新 ReferenceKind、无 facade 改动**。结构确定边**省略 provenance**（不是 `'static'`——见勘误）。实测 method 0→15、contains +15、overrides 0→4，eval RED→GREEN，全量 1490/1490。

> ⚠️ **勘误（实跑核正，下方初版草图有误）**：① `Edge.provenance` 只有 `'tree-sitter'|'scip'|'heuristic'`，**无 `'static'`**；声明级确定边省略 provenance。② `Node` 无通用 `metadata` 字段→用 qualifiedName 编码 owner。③ DESeq2 setMethod 真实写法是 `signature(object="X")`（非裸字符串），第三参常是函数引用；本地 setGeneric 仅 8 个。

<details><summary>初版草图（未采用，保留作设计推演记录）</summary>

- `setGeneric("x", …)` → `kind:'generic'` 节点（或 `function` + `metadata.isGeneric`）。
- `setMethod("x", "Class", fn)` → `kind:'method'` 节点；emit 两条 unresolved_ref：`{referenceKind:'operatesOn', referenceName:'Class'}`、`{referenceKind:'dispatches', referenceName:'x'}`。S4 多签名（`signature=c("A","B")`）→ 多条 `operatesOn`。
- S3 点命名 `print.myClass`：拆**末个**已知 generic（`print`）/ 类（`myClass`），emit `dispatches`/`operatesOn`（带 `confidence<1`，因 `.` 在 R 名字里合法、有歧义）。`UseMethod()`/`registerS3method()` 标记 generic。
- 新 `src/resolution/r.ts`：把上述 `operatesOn`/`dispatches` ref 在**同包命名空间**内按名解析到 class/generic 节点 → 真实 `edges`。
- **验收**：`operatesOn DESeqDataSet` 返回那 15 个方法；`method` kind ≥15；`dispatches` 把 8 泛型各自的方法簇连起来。**多重分派同构**：同套语义直接复用到 Julia（`function f(::T)`）、C++ 重载、Go interface 实现——证明它通用，不只服务生信。

</details>

### 5.3 R 跨包依赖（与 Track A 同期）
- `library()/require()/requireNamespace()/pkg::fn` → 指向 `import:<pkg>` 的真实 `imports` 边（抽取已 emit，补 resolution 让它落成边 + 去重噪声）。
- 解析 `DESCRIPTION`（Imports/Depends/Suggests）+ `NAMESPACE`（export/importFrom）补包边界与导出可见性。
- `source("x.R")` → 项目内相对路径文件级 `imports` 边（给 `import-resolver` 加 `r:['.R','.r']` 项）。

> **天花板（诚实写进文档）**：S4 运行时多分派、NSE（`aes(x=expr)`）、environments-as-objects **静态不可解**。承诺 **确定性抽「声明」**（setClass/setGeneric/setMethod/R6Class 的静态结构）；**不承诺**解析运行时实际分派到哪个方法。每条推断边带 `confidence + provenance`，agent 永不吃到伪造的边。

---

## 6. 通用能力②：跨进程工作流数据流（Phase 1·Track B，生信压力测试，通用价值）

**这是基座彻底没有、且本身通用的能力**：任何 shell out 到 CLI / 用 workflow runner / codegen 的项目都吃得到；生信（Nextflow/Snakemake）只是把它压到极限。colbymchenry 桥**同进程跨语言调用**，OmniWeave 桥**跨进程数据流**——正交、互补。

### 6.1 范围与语法现状
- **Snakemake**（`Snakefile/*.smk`）：`rule` 的 `input/output/shell/script/run` directive。
- **Nextflow DSL2**（`.nf`）：`process` 的 `input/output/script`、`workflow` 通道连接（`|`、`.out`）。grammar 成熟度有限 → `script:` 体用二次定向解析/正则兜底，不强依赖不成熟 grammar。
- **Bash**（基座已支持）：命令调用 → 工具识别。
- 三者都需新增 `src/extraction/languages/{snakemake,nextflow}.ts` + vendored wasm（或正则 fallback extractor，参照基座的 `svelte-extractor`/`liquid-extractor` 这类非 tree-sitter 抽取器先例）。

### 6.2 边构造算法（每条边带 `confidence` + `evidence`）
1. 每个 step（NF process / smk rule）的 `input/output` → `DataArtifact` 节点 + `produces`(step→artifact) / `consumes`(artifact→step)。
2. step 的 `script/shell/run` 体 →
   - 工具调用（`samtools/bwa/STAR/...`）→ `Tool` 节点 + `invokes` 边；
   - 子语言脚本（`Rscript x.R` / `python y.py`）→ 定位目标脚本 → `crossLang` 边（step→script），并对该脚本调**基座既有 extractor** 做子解析，把 workflow 图与代码图缝合。
3. **`准` 的纪律**：脚本路径变量插值、动态拼接 → 标 `provenance:'heuristic'` + `confidence≈0.6`，MCP 返回时显式标注，绝不把猜测当满置信事实。
- **验收**：给定一个 nf-core process / snakemake rule，能追到它最终调用的 R/Python 函数节点（跨进程 + 跨语言一路连通）；数据流边 P/R 达阈值。

---

## 7. 通用能力③：可插拔领域包（bio = pack #1）

**内核永远不认识「生信」**，只认识「领域包」这个数据接口。bio pack 是第一个参考实现；同机制以后能挂 ML pack、data-eng pack。

### 7.1 数据模型（独立于基座既有表）
```sql
CREATE TABLE bio_nodes (              -- 领域实体：Tool / DataArtifact / BioObject / Reference
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, canonical_name TEXT NOT NULL,
  edam_data_uri TEXT, edam_format_uri TEXT, edam_operation_uri TEXT, edam_topic_uri TEXT,
  biotools_id TEXT, bioc_package TEXT, bioc_views TEXT, bioc_s4_parent TEXT,
  file_extensions TEXT, magic_bytes TEXT,
  provenance TEXT NOT NULL DEFAULT 'seed', created_at INTEGER);
CREATE TABLE bio_links (              -- 代码符号 ↔ 领域实体
  id INTEGER PRIMARY KEY AUTOINCREMENT, code_node_id TEXT NOT NULL, bio_node_id TEXT NOT NULL,
  link_kind TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1.0, evidence TEXT,
  file_path TEXT NOT NULL, line INTEGER NOT NULL,
  FOREIGN KEY (code_node_id) REFERENCES nodes(id) ON DELETE CASCADE);
CREATE TABLE edam_concepts (uri TEXT PRIMARY KEY, namespace TEXT, label TEXT, definition TEXT, parent_uri TEXT, obsolete INTEGER DEFAULT 0);
```

### 7.2 关键原则
- **用 EDAM URI 作稳定标识，别用 label**——label 随版本变（`operation_3223` 的 preferred label 从 "Differential gene expression analysis" → "…profiling"）。`format_1930=FASTQ / 2572=BAM / 2573=SAM / 1929=FASTA`（bio.tools API 实测）。
- 识别器：post-indexing pass 扫已索引 `nodes/edges`，把 call site / 字符串字面量 / 文件扩展名 / magic bytes 匹配到 `bio_nodes`，写 `bio_links`（带 confidence）。
- **方便**：ship 一个 curated SEED 注册表（top-N 工具 + top 格式）开箱可用；增量从 bio.tools API / biocViews / 你的 OmniTools/OmniAtlas 生态拉。
- **价值先验证**：领域包是差异化最大、但 agent 实际收益最该被压测的一层——Phase 3 前先用 eval 证明 `bio_lookup` 真为 agent 省了检索，再投入。

---

## 8. Stronger：语义精度层（LSP 混合，先留缝、最后实现）

> 形态铁律（见 §1.5 约束 2）：本层是「**用** LSP 兜顶消歧」，**不是「替」LSP**。callers/callees/impl/定义/诊断是 LSP 主场，OmniWeave 不靠重做它们取胜——只在 LSP 够不着的跨语言/跨进程/动态分派边上立身。

- 目标：把 name-only call 边（同名即连）的 **caller precision 提到 >0.8**。
- 机制：按需起 `pyright`（Python）/ `REditorSupport/languageserver`（R），对 call site 发 `textDocument/definition`（LSP 3.17，0-indexed），用真实定义消歧，结果缓存进 `lsp_cache` 表（付一次）。
- **不进热路径**：tree-sitter 永远是默认快路径；LSP 只在（a）索引期遇歧义边，或（b）查询期精度敏感工具（find-references / impact）时触发。
- **机制性问题真实存在**：name-only 连边会错连（尤其跨语言）；这是本层要解决的。（注：网上「CodeGraph 在某仓库制造 745 错连」的说法是 `tree-sitter-analyzer` 对**自己仓库**的统计，不作通用论据。）

---

## 9. MCP 工具面（agent-serving，好用 + 方便）

- **保留基座 10 工具**（`search/context/trace/callers/callees/impact/node/explore/files/status`），它们已是 token 经济的（ranked + scoped + `file:line` + 最小片段，非文件转储）。
- **新增（Occam 合并，每个对应 agent 真实会问的问题，不堆叠重叠工具）**：

| 工具 | agent 的问题 |
|---|---|
| `dispatch(symbol)` | "哪些方法分派在这个类上 / 这个方法属于哪个泛型、作用于哪个类？"（走 operatesOn/dispatches） |
| `trace_dataflow(node, direction)` | "这个 VCF/对象/文件，上游谁产出、下游谁消费？"（跨进程走 produces/consumes/crossLang） |
| `what_produces(artifact)` / `what_consumes(artifact)` | "谁写出/读入这个数据产物？" |
| `pipeline_dag(workflow_file)` | "这条流水线的 step DAG 长啥样？" |
| `bio_lookup(symbol)` | "这个符号/文件是什么领域实体？"（EDAM/bio.tools/bioc 注解） |

- **provenance 透传**：低 confidence / heuristic 边在返回里显式标注，让 agent 自行校准信任——这是头部工具与玩具的分界。
- 优先复用基座 `trace`/`impact` 让分派与数据流边**自然并入**既有遍历（改一处、评估十处），而非平行造一套图遍历。

---

## 10. 性能契约（可验收数字，继承 + 新增）

| 指标 | 目标 | 继承/新增 |
|---|---|---|
| 冷建索引 | 大仓**秒级**（DESeq2 49 文件 338ms 实测） | 继承（WASM worker 池 + 文件批 I/O） |
| 增量更新 | 编辑→可查 ≈ 2s debounce（可调 `CODEGRAPH_WATCH_DEBOUNCE_MS`） | 继承（content-hash 门控 + staleness banner） |
| 图查询 p99 | 亚毫秒（`node:sqlite` WAL，读不阻塞写） | 继承 |
| 分派/数据流 pass | O(nodes) 名字匹配，**离热路径**（索引后一次） | 新增（不拖慢常态查询） |
| LSP 兜顶 | 懒加载 + 缓存 + 仅精度敏感路径 | 新增 |
| token / 答案 | 每工具有上限，返回结论非转储 | 继承（基座核心卖点，守住） |
| 退化策略 | 超大 monorepo / 超长文件：WASM worker 每 250 文件回收、10s parse 超时重启；显式 `log` 丢弃了什么 | 继承 + 新增 |

---

## 11. Eval 门禁（让「准」变成数字）

- **基座 harness 实况**：`npm run eval` → `__tests__/evaluation/runner.ts`；`scoring.ts` 算 **recall + MRR**，`PASS_THRESHOLD=0.5`；用例是 `searchNodes` + `findRelevantContext`，目前全是 **Elasticsearch/Java**。`EvalReport` 带 `codegraphSha`（可追溯到 commit）。
- **OmniWeave 首件事**：扩 harness——加 **R/S4 用例**（在 DESeq2 上：`operatesOn DESeqDataSet` 应召回 15 方法、`method` kind ≥15、`dispatches` 簇连通）+ **workflow 用例**（nf-core/snakemake 上：crossLang 连通、数据流边 P/R）。先量出 **colbymchenry main 的真实基线**（已实测：S4 `operatesOn=0 / method=0`，即 Track A 基线为零，任何正数都是净增）。
- **双层指标**：
  - 代码层：symbol recall、caller/callee P+R+F1。
  - 语义层：`operatesOn`/`dispatches` P+R、数据流边 P/R、crossLang 准确率、`bio_lookup` 命中率。
- **阶段阈值**：每 Phase 设具体数字门，未达标不进下一阶段（对标交付规范第 9 章）。

> v1 引的 `search F1=0.294 / caller P=0.392` 是 **suatkocar(Rust) 的 eval 值，作废**。colbymchenry 的真实基线要用它自己的 harness 在我们的 R/bio 语料上重测——这是 Phase 0 的产出。

---

## 12. 分阶段路线图（已按真实证据重排）

| 阶段 | 内容 | 验收 |
|---|---|---|
| **Phase 0** | fork colbymchenry/main → 本地 `npm i && npm run build` 跑通 → 扩 eval harness 加 R/S4 + workflow 用例 → 量真实基线 | 基线数字可复现（含 S4 `operatesOn=0` 起点） |
| **Phase 1·A** | **S4/R6 分派图**：r.ts 增 `method` + `operatesOn`/`dispatches`；新 `resolution/r.ts` 同包按名解析；R 跨包依赖（DESCRIPTION/NAMESPACE/source） | `operatesOn DESeqDataSet`→15 方法；`method`≥15；R 跨文件分派边 0→真实 |
| **Phase 1·B**（并行） | **跨进程工作流数据流**：Snakemake/Nextflow/Bash extractor + `dataflow/` 建 produces/consumes/invokes/crossLang | 给定 process/rule 能追到它最终调的 R/Python 函数；数据流边 P/R 达阈值 |
| **Phase 2** | 收口两棒 + 跨进程↔代码图缝合的端到端 trace + MCP 新工具（dispatch/trace_dataflow/pipeline_dag） | 一次 `trace` 跨「workflow→脚本→S4 方法」全程连通 |
| **Phase 3** | 领域包（bio pack #1：bio_nodes/links + EDAM/bio.tools 识别器） | `bio_lookup` 命中率 + 数据流边带正确 EDAM 类型 |
| **Phase 4** | 语义精度层（LSP 混合）+ 扩语言（Perl/AWK/…） | caller precision >0.8 |

> **Phase 1 两棒并行**（用户决策）：A、B 各自带**独立 eval 门禁**，互不阻塞、各自达标——避免战线拉长把门禁变模糊。

---

## 13. 开工前状态 —— 已全部核验（实跑，悬念清零）

1. ✅ **基座 = colbymchenry/codegraph（TS）**，已实跑确认（0.9.8 无 R、main 有 R 但分派图为零）。v1 的 suatkocar/Rust 前提整体作废。
2. ✅ **抽取无 `.scm`、是手写 TS walker** → 判别逻辑直接写在 `r.ts` 的 `visitNode` 里；`operatesOn`/`dispatches` 走 `unresolved_refs` + 新 `resolution/r.ts`。
3. ✅ **eval harness 已存在**（`npm run eval`）→ 不用造子命令，只需扩 R/bio 用例。
4. ✅ **provenance 是 edges 一等列** → 直接复用，不用加表。
5. ⏭️ **fork 落地方式待定**：本地 clone main 作工作基座（不 push、不建公开 fork，除非你明确要）；OmniWeave 文档/设计随 repo 走。

---

## 14. 诚实的天花板（写进验收，防止 agent 信任伪造边）

- R：S4 运行时多分派 / NSE / environments-as-objects **静态不可解**。只抽**声明**，不抽**分派**。
- Perl：sigil/context 敏感。抽 `subroutine/package/class` 声明，不硬解上下文。
- 跨进程数据流：shell 体里动态拼接的命令（变量插值的脚本路径）只能启发式 + 标低 confidence。
- **统一纪律**：基座 `provenance` 仅 `tree-sitter`/`scip`/`heuristic`（**无 seed/static/lsp**——勘误）；确定性边省略 provenance、启发式边标 `heuristic`、`confidence` 必要时进 `Edge.metadata`；MCP 返回时把不确定性透传给 agent。**准 = 不让 agent 吃到一条它以为可信、实则编造的边。**

---

## 附录 A：本次 rebase 的实测证据链（可复现）

```bash
# 1. 你在跑的版本 = colbymchenry，非 suatkocar
codegraph --version                 # 0.9.8
readlink -f $(which codegraph)       # …/@colbymchenry/codegraph/npm-shim.js

# 2. 0.9.8 对 R 是 0（只抓 cpp）
git clone --depth 1 https://github.com/thelovelab/DESeq2
cd DESeq2 && codegraph init -i        # Indexed 2 files（全是 .cpp，15 个 .R 被跳过）

# 3. main 有 R，但 S4 分派图为零
git clone --depth 1 https://github.com/colbymchenry/codegraph cg-main
cd cg-main && npm i && npm run build  # 自带 tree-sitter-r.wasm
cd ../DESeq2 && rm -rf .codegraph
node ../cg-main/dist/bin/codegraph.js init -i   # Indexed 49 files, 292 R 节点
sqlite3 .codegraph/codegraph.db \
  "SELECT kind,COUNT(*) FROM nodes WHERE language='r' GROUP BY kind;"
  # function 186 / file 47 / import 27 / variable 10 / class 3 — 注意：method=0
sqlite3 .codegraph/codegraph.db "SELECT DISTINCT kind FROM edges;"
  # calls / contains / imports — 无 operatesOn、无 extends
```
