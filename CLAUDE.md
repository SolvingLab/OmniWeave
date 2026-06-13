# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目状态：设计阶段 → 即将开工（pre-implementation）

本目录当前有 `OmniWeave-design-v1.md`（**v2，已 rebase 到真实基座**）+ 本文件,尚无 OmniWeave 代码、非 git 仓库。
动手前**先通读 `./OmniWeave-design-v1.md`**——唯一权威设计来源（真实基座事实、SQLite schema、分阶段路线、性能契约、诚实天花板、附录里有可复现的实测证据链）。本文件只给「大图」,细节一律以设计文档为准。

## OmniWeave 是什么

一个**服务 coding agent 的通用代码分析图**（类 codegraph 的 MCP server）,**fork 自 [`colbymchenry/codegraph`](https://github.com/colbymchenry/codegraph)**（MIT、**TypeScript**、`web-tree-sitter`(WASM)、`node:sqlite`(WAL)）。

> ⚠️ **基座勘误（2026-06-13 实跑核正）**：早期文档误判为 `suatkocar/codegraph`（Rust）。**实测推翻**——用户实际在跑的、官网 benchmark 所属的「正牌」CodeGraph 是 **colbymchenry/codegraph（TS）**;suatkocar 只是它一个已停滞的 Rust 衍生。凡涉及 Rust/cargo/`.scm`/`6 参数 extract_edges`/`properties` 列/`0.294-0.392 基线` 的旧表述**全部作废**。

**定位（别框窄）**：不是「生信工具」,是 **more general / stronger / more efficient** 的通用代码分析图。生信（R 的 S4/R6、Perl、Nextflow/Snakemake、工具/数据混编）是**滩头堡 + 压力测试**,不是产品边界——「通用为体,生信为证」。

## 先读（动手前）

- `./OmniWeave-design-v1.md` — 完整设计方案（v2 rebased）
- `~/.claude/projects/-Users-liuzaoqu-Desktop-develop-sogen-new/memory/omniweave-project.md`、`user-liuzaoqu.md` — 项目背景与用户偏好

## 命令（colbymchenry 是标准 npm/TypeScript 项目；clone main 之后生效）

- 安装 + 构建：`npm install && npm run build`（`tsc` + copy-assets 拷 `schema.sql` 与 vendored `tree-sitter-*.wasm`,含 `tree-sitter-r.wasm`）
- 测试：`npm test`（= `vitest run`）｜ 单文件：`vitest run __tests__/<file>`
- **eval（已存在,不用造子命令）**：`npm run eval` → `__tests__/evaluation/runner.ts`（recall+MRR,`PASS_THRESHOLD=0.5`,`EvalReport` 带 `codegraphSha`）。用例目前是 Java/Elasticsearch → **OmniWeave 首件事是扩 R/S4 + workflow 用例并量真实基线**。
- MCP server：`codegraph serve --mcp`（stdio）｜ 索引/查询：`codegraph init -i`、`codegraph index`、`codegraph query`、`codegraph callers/callees/impact`、`codegraph status`
- 本机：用户日用版是 npm 全局 `@colbymchenry/codegraph` **0.9.8**（自带 Node 24 runtime）；跑 main 构建产物需本机 Node ≥22.5（`node:sqlite`,本机 v22.22.3 ✓）

## 架构大图（继承 colbymchenry 分层,差异化往上叠）

```
extraction（WASM worker 池,每语言一个 TS LanguageExtractor + visitNode hook）
  → graph（node:sqlite + FTS5）→ resolution（name-matcher + import-resolver）→ mcp（10 工具）
```

- **加一门语言** = 写 `src/extraction/languages/<lang>.ts`（LanguageExtractor 配置 + `visitNode`）+ 在 `languages/index.ts` 注册 + 放 `tree-sitter-<lang>.wasm`。**手写 TS tree-walker,无 `.scm` 文件**。
- **OmniWeave 的新层**（详见设计文档 §5–§8）：
  - `src/extraction/languages/r.ts`（增 S4 分派）+ 新 `src/resolution/r.ts` — S4/R6 → `method` 节点 + `operatesOn`(方法→类)/`dispatches`(方法→泛型) 边,同包按名解析
  - `src/extraction/languages/{snakemake,nextflow}.ts` + `src/dataflow/` — 跨进程工作流数据流（produces/consumes/invokes/crossLang）
  - `src/domain/` — 可插拔领域包（`bio_nodes`/`bio_links`/`edam_concepts` 三表;EDAM 用 URI 不用 label;bio = pack #1）
  - `src/semantic/` — 按需 LSP 兜顶（pyright / R languageserver 消歧 call 边并缓存）,不进热路径

## 必须知道的真实事实（实跑核验,别再踩这些坑）

- **0.9.8 对 R 是 0**：bundle 无 `r.js`;索引 DESeq2 时 15 个 `.R` 全跳过,只抓 2 个 `.cpp`。R 抽取器是 main（未发布,issue #828）才有的。
- **main 有 R,但 S4 分派图为零**（DESeq2 实测）：类 3/3✓、函数 186,但 **`method`=0、`operatesOn`=0、`extends`=0**,全图边只有 `calls/contains/imports`。`setMethod` 抽成孤立 `function`,不连类/泛型。R6/R5/ggproto 的 list 方法**已是** `method` 类型,**唯独 S4（Bioconductor 主导范式）没接住** → Phase 1 第一刀。
- **抽取无 `.scm`,是手写 TS walker**：判别逻辑直接写 `r.ts` 的 `visitNode`;`operatesOn`/`dispatches` 走 `unresolved_refs` + 新 `resolution/r.ts` 同包名字解析。
- schema：`edges` 元数据列叫 **`metadata`**（JSON）、`provenance` 是**一等列**（直接复用,不用加表）;`kind` 自由文本（加 `method`/`operatesOn` 无需改枚举,落库即所写）。resolution 两段式:抽取 emit `unresolved_refs(reference_kind)` → `resolution/index.ts` 解析成 `edges`。`import-resolver` 扩展名表**无 `r`**、无 R 专属 resolver。
- **eval harness 已存在**（`npm run eval`,recall+MRR）→ 不用造 eval 子命令,只需扩 R/bio 用例。基座真实基线要用它自己 harness 在 R/bio 语料上重测（Phase 0 产出）。
- 性能继承点：WASM worker 每 250 文件回收（线性内存只增不减）、`PARSE_TIMEOUT_MS=10s`、`node:sqlite` WAL（读不阻塞写）、2s debounce watch + staleness banner。

## 工作方式

- **看真实的东西**：任何结论必须读真实源码 / 跑真实命令,有输出才算数;不信 README、不凭记忆。（这条铁律这次直接救了项目——差点 fork 错仓库。）
- **分阶段、eval 数字门禁**：Phase 0 建基线 → Phase 1 两棒并行（A: S4 分派图 / B: 工作流数据流,各带独立门禁）→ Phase 2 收口缝合 → Phase 3 领域包 → Phase 4 语义精度,每阶段不达标不进下一阶段。
- **诚实的天花板**：R 的 S4 运行时分派、NSE、environments 静态不可解——**只抽「声明」不抽「分派」**,每条推断边带 `provenance` + `confidence`,绝不给 agent 一条伪造的边。

---

# 工程交付强制规范（极致严谨·零妥协）

## 0. 总纲

本规范为交付硬约束，不是建议。任一条款未达标，视为未完成，不得交付。

默认立场：能删则删，能并则并，能简则简。复杂度不是能力，是负债。

## 1. 需求与决策

1. 严格遵循奥卡姆剃刀：每一个功能、抽象、组件、状态、动画，都必须回答「删掉它，用户会变差吗？」若答案是否，必须删除。
2. 全程站在用户视角推导需求，禁止工程师自嗨式实现。判断标准不是「能不能做」，而是「用户在这一秒是否需要、是否感知价值、是否愿意为此等待」。
3. 时间成本、认知负荷、操作步数、视觉干扰，与功能正确性同等重要，必须一并纳入设计，不得事后补丁。

## 2. 视觉与交互

1. 视觉遵循极简设计美学：克制、纯粹、留白、节奏、层次。拒绝装饰性复杂度，拒绝「看起来做了很多」的空洞感。
2. 简约不等于简陋。每一屏、每一帧、每一次过渡，都必须经得起逐帧审视——每一帧都应值得截图。
3. 全流程交互流转无断点：输入、反馈、加载、错误、空态、恢复，全部连贯一致，不得出现体验断层。
4. 整体操作体验必须绝对丝滑。凡用户可感知的动作——滚动、切换、拖拽、聚焦、展开——须如物理世界般自然，零迟滞、零突兀、零「等一下」感。

## 3. 性能（底层硬约束）

1. 全链路以高性能为底层硬性约束。逻辑、渲染、交互、网络、内存，全部优先保障性能表现；性能不是优化项，是设计项。
2. 禁止主线程长时间阻塞；禁止无必要的重渲染、布局抖动（layout thrashing）、级联 reflow；能异步则异步，能延迟则延迟，能虚拟化则虚拟化，能缓存则缓存。
3. 长列表、长会话、大文本、高频更新场景，必须在设计阶段给出性能方案，禁止靠「机器够快」硬扛。
4. 交付时须能说明：关键路径耗时、渲染频率、内存边界、极端数据量下的退化策略。

## 4. 流式渲染（产品化红线·不可妥协）

流式渲染是产品核心硬指标，是商业化成熟产品的核心评判标准。

1. 输出渲染全程须保持 60fps 级流畅；禁止可见掉帧、跳帧、闪烁、布局重排导致的画面抖动。
2. 流式输出过程中，用户向上翻阅历史内容时，必须零卡顿、零延迟、零拖影、零 scroll jump、零内容位移。
3. 禁止因新内容插入导致阅读位置被抢、视口被拽、滚动条异常跳动。须正确处理 scroll anchoring、虚拟列表、增量布局稳定性。
4. 流式更新不得阻塞用户交互；用户滚动、选中、复制、暂停时，系统必须优先响应用户意图，而非无脑追写最新 token。
5. 若做不到上述任一条，不算完成，必须重构，不得用「差不多」「大多数情况可以」搪塞。

## 5. 主动治理（删、改、重构）

1. 主动识别所有逻辑不合理、架构冗余、体验割裂、视觉违和、命名混乱、状态泄漏、边界缺失的模块。
2. 对以上问题执行删除、优化或整体重构；不做折中妥协，不留「以后再说」，不接受临时 hack 长期驻留。
3. 若局部优化破坏全局一致性，宁可回退局部改动，也不允许引入系统级割裂。

## 6. 全局统一

1. 针对任何细节，若产出更优实现方案或底层设计哲学，优化后必须保证架构、视觉、交互、命名、错误处理、动效节奏全局统一。
2. 禁止同一产品内出现多套平行范式：两套按钮逻辑、两套 loading 语义、两套滚动行为、两套状态管理模式。
3. 所有新增须能归入现有设计系统 / 架构分层；若不能归入，先修系统，再加功能。

## 7. 代码标准

1. 结构整洁干净：命名即文档，结构即意图；读代码应像读 prose，不应像解谜。
2. 底层执行高效：热点路径优先；禁止过早抽象，也禁止复制粘贴式重复。
3. 思考覆盖全场景：正常路径、异常路径、弱网、断连、重试、取消、并发、竞态、长会话、大数据、空数据、权限变化，须在实现前纳入设计。
4. 周全处理用户维度：时间计算、视觉分层、资源调度、焦点管理、可访问性、键盘操作、国际化扩展性，全部纳入交付范围，不得遗漏。
5. 禁止交付：魔法数、隐式副作用、无法追踪的状态源、无注释却非自明的 trick、仅为「能跑」的脆弱实现。

## 8. 冰山法则（全局架构思维）

1. 编码必须具备全局架构思维：改一处，须评估十处；模块边界、数据流、生命周期、依赖方向必须清晰。
2. 严格遵循冰山法则：表层简洁易读，底层逻辑完整厚重。
3. 用户只见 10% 的交互简洁；背后 90% 的健壮性、性能、容错、可观测性，必须默默托底，且可被维护者理解。

## 9. 交付前强制验收（深度复盘 + 二次全量核验）

交付前必须完成逐粒度排查，杜绝疏漏。以下任一项为否，禁止交付：

1. 是否存在任何可感知卡顿，尤其是流式输出时的上下滚动？
2. 是否存在 layout shift、scroll jump、内容抢焦点？
3. 是否存在可删而未删的复杂度？
4. 是否存在与全局设计语言冲突的实现？
5. 是否存在仅 happy path 可用、边界即崩的实现？
6. 是否能在不看作者解释的情况下，被他人快速理解与修改？
7. 若交给顶级工程团队 review，是否会感到羞愧？

## 10. 终极标准

交付代码须达到行业标杆范本层级：

1. 可供 OpenAI、Google 等头部企业逐帧拆解、完整学习、规范复刻。
2. 整体品质对标顶级大厂工程标准：美学、性能、架构、可维护性、用户体验，五者同时达标，不允许单项牺牲换另一项。
3. 每一处取舍都必须经得起三连问：为什么这样写？为什么不再简？为什么这样快？

对得起这个标准。未达标，不算交付完成。
