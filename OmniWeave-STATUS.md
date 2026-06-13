# OmniWeave — 实时操作态 & Phase 1 作战手册（HANDOFF）

> 给新会话：这是「现在在哪、下一刀切哪、怎么验证」的唯一操作真相。读完本文 + `CLAUDE.md` + `OmniWeave-design-v1.md`（v2，已 rebase）+ 两个 memory，即可无缝接手。**铁律：看真实的东西，跑真命令读真源码，有输出才算数。Ultracode 已开 → 每个实质步骤用 Workflow 编排 + 对抗式验证，对齐头部水准。**

## 0. 一句话现状
基座勘误已完成：fork 的不是 suatkocar(Rust)，是用户**实际在跑**的「正牌」**`colbymchenry/codegraph`（TypeScript）**。Phase 0、Phase 1（两棒）、**Phase 2 全部三件（①端到端三跳 trace+agent 可达性 §0.7、②真实大语料压测 §0.8、③MCP 工具决策）已全部完成并全验证**。**11 个 eval 门禁全绿**（DESeq2 2/2 · Workflow 4/4 · Capstone 5/5）、**全量 vitest 1490/1490 过、0 回归**。亮点：(a) workflow rule →(crossLang)→ R 脚本 →(contains/calls)→ **S4 方法** →(overrides)→ generic 跨进程+跨语言+动态分派**贯通成一条可导航链**；(b) 修好 explore 丢 file bridge 节点、使该链对 agent 不可见的真 bug；(c) 真实 snakemake + nf-core 仓压测 crossLang recall/precision **双 100%**，并补上 nf-core `template` 主导机制（0→7）。Phase 2 ③ 经 §1.5 闸门判定**不加专用 MCP 工具**（改 server-instructions 提示）。**Phase 3'「证值优先 + 扩通用 polyglot」（用户 2026-06-13 拍板，非 bio 领域包）：Track 2 扩通用 crossLang 已完成（§0.11）**——crossLang 从「仅工作流文件」泛化到任意 Python/JS/TS/Go 文件的 subprocess/os.system/child_process/exec.Command 跨进程调用，边从调用方函数出发，3 例 RED→GREEN，精度负样本零边。**Phase 3' 两轨全完成**：Track 2 扩通用 crossLang（§0.11）+ Track 1 证值 benchmark（§0.12，`npm run benchmark`，OmniWeave-wins 5/TIED 1/grep-wins 1，诚实方法学）。**方向 A（把通用 crossLang 打到生产级·真仓 recall 证过）已完成并全验证（§0.13）**——在真实 Python 编排仓 **quarTeT** 上量到 recall **0/5→5/5**，修了两个真实 recall 缺口（`{sys.path[0]}/x.py` f-string this-dir 前缀 + 模块顶层 `__main__` 分派无 enclosing fn → 回退文件节点）+ 对抗 Workflow 又揪出并修了 ReDoS（97s→0.1ms）、`check_call`/`execFileSync`/`spawnSync` API 漏、`echo`/straddle 假阳。**20 eval 门禁全绿**（polyglot 9 · capstone 5 · workflow 4 · deseq2 2，含新 `maxEdgeCount` 精度负样本门）、vitest 1490/1490、**6 个真仓 0 假阳**、0 回归。**方向 A 第二部分（benchmark 跑真实大语料）也已 DONE**——`capability-matrix.ts` 加 env-gated 真仓附录(quarTeT 5 跨进程边/DESeq2 15 S4 方法/nf-core 7 跨语言/rna-seq 6+61 DAG),canonical `results/` 仍 fixture-only 可复现。**方向 A 全部完成。** 用户随后选 **Phase 4 语义层 de-risk**——**de-risk 结论(§0.14,证据决定性)**:Phase 4「LSP 消歧 call 边」**= 错误投资**(R 旗舰仓主导歧义是 S4 分派,R-LSP 也静态解不了=诚实天花板;Python pyright 又和 agent 自带 LSP 撞车 §1.5②),**不建 LSP 层**;但 de-risk 揪出**更优、§1.5 纯正的改进并已实施**:S4 generic 调用从 proximity 瞎猜(conf 0.4、偶尔误打 method)改为**高置信连 generic**(用 Phase 1·A 分派图),DESeq2 真仓 83 条歧义边升级 0.4→0.9、method 误打清零。**随后「深化剩余歧义」调查**(§0.14 续)把规律泛化:剩余 35 条歧义里 10 条是 class+同名构造函数(目标已对、仅置信低)→ 统一成「R bare call 优先 qn===name 的 function(自由函数/generic/构造函数),其余全 class/method 时高置信」一条规律,DESeq2 构造函数 10 条再升 0.4→0.9;剩 ~25 条经核验是**真歧义**(外部 generic 多方法/重复闭包/作用域遮蔽)——0.4 是诚实天花板正确工作。**23 eval 门禁全绿**(polyglot 9·capstone 8·workflow 4·deseq2 2)、vitest 1490/1490、tsc 干净、0 回归。用户随后选 **bio 领域包最小 eval**——**结论 NO-GO(§0.15,证据决定性)**:真实流水线步骤名 ~100% 自文档(rna-seq 24/25、nf-core 21/21 含工具名)+ OmniWeave 现有 crossLang 已恢复工具 + LLM 自有知识 = EDAM/bio.tools 三表纯冗余,**不建**(§1.5 ROI 久疑了断,证据说别堆就不堆)。合法内核另议:`invokes`(step→外部 shell 工具,§5)比 EDAM 标注更值,但非三表。用户随后选 **建 `invokes`/Tool 边**——**已完成全验证(§0.16)**:新 EdgeKind `invokes`+NodeKind `tool`,从 Snakemake `wrapper:` 路径(`bio/<tool>/<sub>`,高精度无需 shell 解析)抽取外部工具,name-keyed 共享节点(`callers(STAR)` 列全流水线 STAR 用法)。补 crossLang 缺口(它只连本地脚本、不连 bwa/samtools/STAR 外部二进制)。真仓 rna-seq **7 工具/10 invokes 边/0 假阳**(只落 10 个 wrapper 规则、script:/shell: 规则零误编),端到端 callers/callees 打通、server-instructions 已加提示。**25 eval 门禁全绿**(polyglot 9·capstone 10·workflow 4·deseq2 2)、vitest 1490/1490、tsc 干净、0 回归。用户随后选「其他方向」→ 我 **de-risk 了 Makefile crossLang(§0.17)**:价值真实(1684 真实仓、通用编排)但**是实质子系统**(管线集成 + Make 语义 `$(VAR)`/`$<`,Makefile 现在 `detectLanguage`→`unknown` 根本不索引),**MVP 设计已就绪、待新鲜专注做扎实**(不在马拉松尾巴赶成脆弱实现)。**下一步候选**:① 建 Makefile crossLang MVP(设计就绪,§0.17) ② `invokes` 扩 shell 源/nf-core ③ bare-call routing 泛化 Julia/C++/Go。未 commit（按规矩等用户明确要求）。

## 0.8 Phase 2 ② 真实大语料压测广度 — DONE（2026-06-13，全验证）
- **方法**：clone 两个真实生信工作流仓库实跑（`/tmp/cg-probe/real/`），量 recall/precision，诚实记录降级。受控 fixture 已证机制正确，此处证广度与鲁棒。
- **snakemake-workflows/rna-seq-star-deseq2**（30 文件/290 节点/141ms）：rule 节点 **25/25**（跨 Snakefile + 5 个 `rules/*.smk`，含 `rules/*.smk → ../scripts/*.R` 跨目录相对路径解析）、`script:` crossLang **6/6**（confidence 0.95）、**0 假阳**（10 个远程 `wrapper:` 正确未编边）、artifact 61 / produces 53 / consumes 35。
- **nf-core/differentialabundance**（102 文件/301 节点/332ms）：process 节点 **21/21**。**发现真实缺口**：crossLang **0/7**——nf-core DSL2 模块的主导跨语言机制是 `template 'x.R'`（指向模块旁 `templates/x.R`），我原合成器只认 Snakemake `script:` + shell `Rscript/python`，**不认 `template`**。
- **修复（主动治理，已落地）**：`callback-synthesizer.ts` 加 `TEMPLATE_DIRECTIVE_RE`，`template 'x.R'` → `<moduleDir>/templates/x.R`（literal 无歧义 → confidence 0.95）。顺手把脆弱的 `sd && raw===sd[1]` 置信判定重构成 candidate 显式带 `confidence`（script:/template=0.95、shell=0.8）。**实测 nf-core crossLang 0→7/7**（每 process 正确连 `templates/*.R`），snakemake **无回归（仍 6/6）**。
- **精度 100%**：两仓全部 crossLang 边正确、零假阳。`Rscript -e "..."`（无 .R 路径不匹配）、PATH 上的包脚本（shinyngs 等非本地文件被 `fileExists` 门挡）、远程 wrapper、动态插值路径——全部**正确未编造**（诚实天花板：只抽静态可解的，每条边带 provenance:'heuristic'+confidence）。
- **永久门禁**：capstone fixture 加一个极简 Nextflow 模块（`modules/predict/main.nf` 用 `template 'predict.R'` + `templates/predict.R`），使该 fixture 同时覆盖 **两引擎** crossLang 机制。新 eval 例 `capstone-nextflow-template-crosslang`（assertEdges PREDICT outgoing crossLang≥1）。**capstone 现 5/5**。
- **结论**：Snakemake `script:` + Nextflow `template` + Nextflow shell `Rscript/python` 三种跨语言机制全覆盖，真实大语料 recall/precision 双 100%，索引快（百文件 <350ms）无错。改动文件：`src/resolution/callback-synthesizer.ts`、`__tests__/fixtures/capstone/modules/predict/{main.nf,templates/predict.R}`（新）、`__tests__/evaluation/test-cases.ts`。

## 0.10 Phase 3' 启动「证值优先 + 扩通用 polyglot」（2026-06-13，方向已定 + gap 已 de-risk）
- **方向（用户拍板）**：放弃/推迟 bio 领域包（§1.5 对其 ROI 存疑），转做最契合「通用为体」且 no-regret 的两轨：**轨1 证值**——真实 agent 任务上量化 OmniWeave vs grep/LSP 的 token 经济 + 召回（§1.5 核心命题）；**轨2 扩通用 polyglot**——crossLang 从「仅 workflow 文件」泛化到任意文件的跨进程/跨语言调用。
- **gap 已 de-risk 实证（铁律①）**：探针 `/tmp/cgsub`（`pipeline.py` 用 `subprocess.run(["Rscript","scripts/deseq.R"...])` + `os.system("python scripts/report.py")` 调 R/py 脚本）→ 当前 **crossLang=0**（全图仅 contains/imports），`run_analysis→deseq.R`、`make_report→report.py` 全漏。**根因**：`workflowCrossLangEdges` 入口 `if (!ctx.getAllFiles().some(isWorkflowFile)) return []` 把 crossLang 闸死在 Snakemake/Nextflow。已有的 `SHELL_INVOKE_RE` 能认 `Rscript x.R`，但只跑在 workflow-step 节点体上。
- **泛化要点（设计 Workflow 待定）**：① 在任意文件检测解释器调用——Python `subprocess.run/call/check_output/Popen`、`os.system`；Node `child_process.exec/execSync/spawn`；shell 脚本；Makefile recipe；可能 Go `exec.Command`。② 边从**调用方函数节点**出发（让 `callees(run_analysis)` 够到 deseq.R），需定位 subprocess 调用的 enclosing function。③ **精度是通用代码的主要风险**（字符串可能出现在注释/日志/docstring/测试），confidence + fileExists 门 + 诚实天花板要更严。④ 复用既有 crossLang EdgeKind + bridge 透传（explore 已能展示），不新增类型。
- **设计 Workflow 已跑完**（Understand×3 + Design + 对抗预审）。预审抓到 3 个真 bug（见 §0.11），其中两个我**实跑翻案/确认**后才采纳——典型「不轻信、看真实」。**Track 2（扩通用）+ Track 1（证值 benchmark）均已完成**（§0.11、§0.12）。

## 0.12 Phase 3' Track 1 §1.5 证值 capability-matrix benchmark — DONE（2026-06-13）
- **目的**：§1.5 要求「价值靠 eval 数字证明，不靠『图天然更好』的信仰」。脚本 `__tests__/evaluation/capability-matrix.ts`（`npm run benchmark`）量化 OmniWeave vs grep vs LSP 在差异化查询上的表现，emit `results/capability-matrix.{md,json}`。
- **诚实方法学（采纳 premortem S2）**：① grep 基线**真跑 `grep` 进程数真实输出行**（agent 实际消费的 stdout，不是文件总行数——premortem 抓到原设计把「文件总行」当「消费行」灌水）；② 论点明确落在**结构化/可组合/跨边界**，不是裸字符数（grep 可以很简洁，已声明）；③ **含 TIED（Q6 定义查找）+ GREP-WINS（Q7 全文检索）防 cherry-pick**；④ LSP 判定**引 LSP 3.17 spec 的 request-type 缺口**（不起 server，避免 server 质量变量，缺口是范畴性的）；⑤ crossLang 边的 `confidence`+`heuristic` 在表里**明示不藏**。基于**已提交 fixture**（capstone + polyglot-subprocess）→ clean checkout 可复现。
- **结果（7 查询）**：OmniWeave-wins 5（Q1 S4 分派表成员 / Q2 Snakemake rule→脚本 / Q3 三跳组合 / Q4 Nextflow template→R / Q5 通用 py subprocess→R），TIED 1（Q6），GREP-WINS 1（Q7）。**核心论点**：Q1–Q5 全是跨边界（S4 分派注册表 / workflow→脚本 / py→R subprocess）或需组合（Q3）的查询——LSP **范畴性**够不着（非速度差），grep 对 Q3 **结构上无法证明跳间共享节点**；Q1/Q2/Q4/Q5 grep 可行但返回无结构文本、无边可续走。Q6 诚实 TIED、Q7 诚实 grep 赢。
- **改动**：`__tests__/evaluation/capability-matrix.ts`（新，~210 行）、`package.json`（+`benchmark` script）。vitest 仍 1490（脚本非 `*.test.ts` 不被收集）。

## 0.17 Makefile crossLang de-risk（用户选「其他方向」）— DONE de-risk，未建（2026-06-13）
- **方向**：把 crossLang/invokes 从 Snakemake/Nextflow 扩到 **Makefile**(通用编排,合「通用为体」非生信专属)。按铁律先看真实再写码。
- **真实样本(`trr266/treat`,可复现研究模板)**：
  ```make
  RSCRIPT := Rscript --encoding=UTF-8        # 解释器 = Make 变量
  PYTHON := python
  $(RESULTS): ... code/R/do_analysis.R ...
  	$(RSCRIPT) code/R/do_analysis.R          # ✓ 字面脚本 + $(VAR) 解释器
  $(WRDS_DATA): code/python/pull_wrds_data.py ...
  	$(PYTHON) $<                             # ✗ 脚本是 $<(首依赖),需 Make 语义
  ```
  GitHub `filename:Makefile Rscript python` = **1684 真实仓**,模式普遍。脚本都是真实仓内文件(code/R/*.R、code/python/*.py)。
- **三个真实挑战(crossLang 现不处理)**：① 解释器是 `$(RSCRIPT)`/`$(PYTHON)` **Make 变量**(`SHELL_INVOKE_RE` 认字面 Rscript/python,不认 `$(VAR)`);② 脚本常是 **自动变量 `$<`**(=首依赖),需解析 target 的 prereq 行;③ target/prereq 本身用 `$(VAR)`(如 `$(WRDS_DATA)=$(shell yq ...)` 全动态→honesty ceiling skip)。
- **管线阻塞(实测)**：Makefile 当前 `detectLanguage` → **`'unknown'` → 根本不被索引**(grammars.ts:339 `unknown` 直接 return false)。`.smk` 能 tag `'python'` 复用 grammar,**Makefile 无可复用 grammar**。
- **结论**：Makefile crossLang **价值真实**(1684 仓、通用、§1.5 跨进程 LSP 够不着)**但是实质子系统**——需 ① 抽取管线接入(注册 Makefile 为可索引、处理无 grammar)② Make 语义抽取器(targets/变量 `$(RSCRIPT)`/自动变量 `$<`/prereq)③ 复用 crossLang/invokes 出边。**非 resolver 小改,该用新鲜专注做扎实**(赶易成 §0 禁止的脆弱实现)。de-risk 已把它从路线图想法推进到「设计就绪 + 挑战/阻塞已测绘」。
- **MVP 设计(就绪,待建)**：detect Makefile(`Makefile`/`makefile`/`*.mk`)→ 新增可索引 file-type(或 framework-only 抽取,绕过 tree-sitter)→ 收集 `VAR := value` 中解释器变量 → 解析 `target: prereqs` + tab-recipe → recipe 里 `$(INTERP)|literal-interp` + `literal-script|$<→首依赖script` → emit crossLang(target→script)/invokes(target→tool),复用既有机制。动态 `$(VAR)` 路径 skip(诚实天花板)。`trr266/treat` 可作真仓验证(literal `$(RSCRIPT) code/R/do_analysis.R` + `$(PYTHON) $<` 两形态)。

## 0.16 invokes/Tool 边（step → 外部命令行工具）— DONE（2026-06-13，全验证）
- **来源**：§0.15 bio 包 eval(NO-GO)浮出的「合法内核」——真正缺的结构是 **step→外部 shell 工具**(crossLang 只连本地 .R/.py 脚本,**不连 bwa/samtools/STAR 这类外部二进制**)。用户拍板建它(比 EDAM 标注有用:给原始工具、LLM 自映射操作;§1.5 纯正:跨进程、LSP 够不着)。
- **de-risk(铁律:先看真实再写码)**:真仓 rna-seq 信号普查——`wrapper:` 路径 `v7.2.0/bio/<tool>/<sub>`(bwa/fastp/multiqc/samtools/star/sra-tools/reference,**10 条 wrapper 规则,高精度无 shell 解析**)是干净主信号;`shell:` 可执行(rseqc 的 read_GC.py 等 PATH 工具)是启发式次信号(需 denylist)。**MVP 定界:先 wrapper-only**(干净可验证),shell/nf-core 作已记录后续。
- **实现**:新 NodeKind `tool` + EdgeKind `invokes`。`workflow.ts` 加 `toolNode`(id `workflow-tool:<name>`,**name-keyed 共享**——每个跑该工具的 step 落同一节点,`callers(STAR)` 聚合全流水线用法)+ `WRAPPER_TOOL_RE`(`\bbio/([a-z0-9_-]+)`)+ `stepWrapperTools`(扫 `wrapper:` 段,路径可在指令行或下一行)+ `linkTools`(emit tool 节点 + `invokes` ref)。`resolve()` 加 invokes 分支(按名匹配 tool 节点,wrapper 无歧义→1.0)。镜像既有 artifact/produces 模式。
- **涟漪(新 kind 进 6 处,记牢)**:`types.ts`(NodeKind+`tool`、EdgeKind+`invokes`)、`formatter.ts` significantEdges、`context/index.ts` recoveryKinds、`mcp/tools.ts` RANK_EDGES、`traversal.ts` **BRIDGE_EDGE_KINDS**(让 tool 节点经 invokes 到达时survive HIGH_VALUE 过滤,对 explore/agent 可见)+ callers/callees 两处边表。`server-instructions.ts` Polyglot 链加 `invokes`/`callers(STAR)` 提示。
- **验收**:capstone 加两条 star wrapper 规则(star_index+star_align 共享 `tool:star`),2 门禁 RED→GREEN(`callees(star_align)`→tool / `callers(star)`≥2 聚合)。端到端实测 `callers star`→star_index+star_align、`callees star_align`→tool:star+artifacts。**真仓 rna-seq:7 工具/10 invokes 边、精度完美**(只落 10 个 wrapper 规则,deseq2/pca/rseqc_* 等 script:/shell: 规则零误编)。**25 eval 门禁全绿**(polyglot 9·capstone 10·workflow 4·deseq2 2)、vitest 1490/1490、tsc 干净、0 回归。
- **改动文件**:`src/types.ts`、`src/resolution/frameworks/workflow.ts`(tool 抽取+resolve)、`src/context/{formatter,index}.ts`、`src/mcp/{tools,server-instructions}.ts`、`src/graph/traversal.ts`、`__tests__/fixtures/capstone/Snakefile`(2 star 规则)、`__tests__/evaluation/test-cases.ts`(2 门禁)。
- **后续候选(记录)**:shell 工具源(`shell:` 体首 token，denylist mkdir/mv/cd/echo 等 builtin+coreutils,排除 crossLang 已管的解释器)、nf-core 工具(process 名 `TOOL_SUB` / script 块 / conda 指令)。

## 0.15 bio 领域包最小 eval（§1.5 ROI 久疑的了断）— DONE（2026-06-13，证据决定性）→ NO-GO
- **用户选了「bio 领域包最小 eval」**。按 §1.5「先用 eval 证明 agent 真受益再投入,没有可量化受益就别堆三张表」+ 铁律「看真实」——**不先设计抽象 eval,先在真实 bio 流水线找答案**:有没有一个真实 coding-agent 任务,因为知道「某步骤 ↔ EDAM operation / bio.tools 条目」而做得更好,且 grep+LLM 自有知识做不到?核心怀疑:agent 的 LLM **本就知道**「DESeq2 做差异表达」,EDAM 标注可能纯冗余。
- **两轴真实证据(决定性)**：
  - **轴1·步骤名自文档性**:`snakemake-workflows/rna-seq-star-deseq2` **24/25 rule 名直接含工具/操作**(bwa_index/star_align/fastp_*/multiqc/deseq2/pca/rseqc_*/count_matrix/gene_2_symbol,仅 `all` 是聚合靶);`nf-core/differentialabundance` **21/21 `TOOL_SUBCOMMAND` 约定**(DESEQ2_DIFFERENTIAL/LIMMA_DIFFERENTIAL/GPROFILER2_GOST/GSEA_GSEA/AFFY_JUSTRMA...,名字字面含工具)。**两生态 0 隐晦命名** → EDAM operation 标注**和步骤名冗余**,LLM 读名即懂。
  - **轴2·结构已恢复工具**:`callees(deseq2 rule)` →(crossLang,OmniWeave 已有)→ `deseq2.R`,脚本里 `library("DESeq2")`+`results()`。**即便名字隐晦,agent 顺现有 crossLang 边就到脚本、见真实工具**,LLM 再映射操作——**无需 EDAM 表**。
- **结论:NO-GO,不建 bio 领域包(bio_nodes/bio_links/edam_concepts 三表)**。§1.5 ROI 怀疑被真实数据坐实:真实流水线步骤名 ~100% 自文档 + OmniWeave 现有 crossLang + LLM 自有知识 = 语义角色已覆盖;EDAM/bio.tools 表只是在「已能找到的工具 + 已懂的操作」上再叠 ontology URI = §0「复杂度即负债」。**这正是 §1.5 纪律要拦的「为信仰堆三张表」。** 投资决策:不投。
- **诚实边界(narrow niche,记录不追)**:pack 仅在「① 步骤/函数名隐晦 ② 工具是**纯进程内库**(无 shell-out,crossLang 够不到)③ token 预算紧到不读 body」三者同时成立才有边际价值——真实约定命名的流水线不出现,unevidenced。
- **更值得的「合法内核」(另议,非本投资)**:真正缺的结构是 **step→外部 shell 工具**(`shell: "STAR --..."` 现在 crossLang 只连本地 .R/.py 脚本、**不连 bwa/samtools/STAR 这类外部工具**)。一条轻量 `invokes`(step→`tool` 节点)比 EDAM 标注更有用(给原始工具、LLM 自映射操作)且 §1.5 纯正(结构、跨进程、LSP 够不着)——这是设计文档 §5 的 `invokes`/`Tool` 想法,可作为独立候选,**但不是 EDAM 三表**。
- **复现命令**:见上(`grep '^rule '`/`process` 数步骤名 + `callees deseq2` 看 crossLang→脚本→`library(DESeq2)`)。**无代码改动**(证据说别建,就不建——这本身是交付)。

## 0.14 Phase 4 语义层 de-risk + S4 generic-call routing — DONE（2026-06-13，全验证）
- **用户选了 Phase 4 de-risk**。按 goal「先建『歧义 call 边』红门禁再接」,做了**有界证据调查**:OmniWeave 把同名调用解析成歧义/错 `calls` 边的真实比率多高?值得用 pyright/R-LSP 按需消歧吗(且不与 agent 自带 LSP 撞车 §1.5②)?
- **机理实测(看真实)**:`resolveOne` 只返回**最高置信单候选**(不过连);歧义发生在 `matchByExactName`——多候选时 `findBestMatch` 按**路径邻近度**择一,置信 **0.7(近)/0.4(远)**。**`calls` 边已存 `metadata.confidence`+`resolvedBy`**(可直接量化)。
- **真仓量化(DESeq2,R 旗舰)**:1056 calls 中 **118(11.2%)歧义**(全 conf 0.4)。主导歧义名 `normalizationFactors`(29)/`dispersionFunction`(25)/`dispersions`(21)/`priorInfo`(8) **全是 S4 generic**(setGeneric 确认)。**且不一致**:`dispersions` 20→generic/**1→method**,`normalizationFactors` 24→generic/**5→method**——proximity 时对时错。
- **de-risk 决定性结论**:**Phase 4「LSP 消歧」= 错误投资**。① R 侧主导歧义是 **S4 运行时分派**,**R languageserver 也静态解不了**(就是诚实天花板,LSP 帮不上);② Python 侧 pyright 消歧**和 agent 自带 LSP 撞车**(§1.5② 明令别撞);③ OmniWeave **已**用 conf 0.4 诚实标注歧义边、agent 已被警示。**不建 LSP 层。**
- **更优、§1.5 纯正的替代(已实施)**:bare S4 generic 调用 `dispersions(x)` 静态就是调 **generic**(运行时才分派到方法,谁跑是 undecidable=诚实天花板)。修法:`name-matcher.ts` 的 `matchByExactName` 加 **R-gated 分支**——候选含 S4 generic(`function` 且 qn===name,来自 setGeneric)+ 同名 method(qn `Class::name`,来自 setMethod)时,**解析到 generic、置信 0.9**;分派候选仍经 method→generic 的 `overrides` 边可达。**零 LSP、零 §1.5 撞车、用 Phase 1·A 已建分派图**。
- **实测影响**:capstone `fit(model)` 0.4→method **改为** 0.9→generic;**DESeq2 真仓 `dispersions` 21 条全 →generic@0.9(原含 1 method 误打)、`normalizationFactors` 29 条全 →generic@0.9(原含 5 误打)**;全仓 calls **0.4 从 118→35**(83 条歧义升级 0.9,总数 1056 不变、无边丢失),剩 35 是真·非-S4 重名(正确留 0.4)。
- **永久门禁(红→绿 + 有牙)**:capstone fixture **天然已含此 bug**(`fit(model)` 调用)。harness 加 **`symbolKind`** 字段(`types/runner.ts`)——按 kind 锁同名节点,区分 generic(function)/method。两门禁:`capstone-s4-generic-call-to-generic`(generic incoming calls≥1)+ `capstone-s4-generic-call-not-method`(method incoming calls **max 0**,有牙)。**RED(generic 0/method 1)→GREEN**。e2e 链门禁**不破**(它经 `model.R --contains--> fit(method)` 仍 2 跳可达,非靠那条 calls 边)。
- **验收**:**22 eval 门禁全绿**(polyglot 9·capstone 7·workflow 4·deseq2 2)、vitest **1490/1490**、tsc 干净、0 回归。
- **续:「深化剩余歧义」调查(用户选)— DONE**：解剖 DESeq2 修复后剩的 35 条 0.4 歧义边。分类:**① 10 条 class+同名构造函数**(`DESeqDataSet`/`DESeqResults`/`DESeqTransform`,`class:X`+`function:X`;bare `DESeqDataSet(...)` 调的是构造函数,R 类不可直接调用;目标已对、仅置信 0.4 低)→ **可系统修**;**② ~25 条真歧义**(`plotMA` 外部 generic+2 method、`pfunc`/`vst.fn` 重复闭包、`fitBeta`/`fitDisp` 重复函数、`vst` 作用域遮蔽)→ **0.4 正确,诚实天花板在工作,不动**。**结论本身有价值:S4 修复后剩余歧义大多合法**。
- **统一规律(把 S4-generic 与构造函数合一)**：`matchByExactName` 的 R-gated 分支泛化为——候选含 **qn===name 的 function**(顶层可调用:自由函数/generic/构造函数)且**其余候选全是 method 或 class**(非 bare-callable)→ 优先该 function、置信 0.9。**故意不触发**当存在竞争的同名 function(嵌套遮蔽/真重复)→ 留 proximity。DESeq2 构造函数 10 条 0.4→0.9(0.4 总数 35→25)。
- **门禁(置信校准要有牙)**：构造函数目标本就对(findBestMatch 已偏好 function),只是置信低 → harness 加 **`minConfidence`** 字段,gate `capstone-r-constructor-call-high-confidence`(GeneModel 构造调用 incoming calls 置信≥0.9≥1 条)。capstone fixture 加同名构造函数 + 改调用点 `model <- GeneModel(counts)`。实测有牙:该边恰 0.9,minConfidence 0.95 即 RED。**capstone 7→8**。
- **可泛化(下一步候选)**:bare-call routing 的「调用→分派/构造入口,具体目标经 dispatch 图可达」范式可推广到 Julia 多分派、C++ 虚函数、Go interface——同一 §1.5 纯正模式(用已建分派图,不碰 LSP)。
- **改动文件**:`src/resolution/name-matcher.ts`(R bare-call routing,S4-generic + 构造函数统一)、`__tests__/evaluation/{types,runner,test-cases}.ts`(symbolKind + minConfidence + 3 门禁)、`__tests__/fixtures/capstone/scripts/model.R`(构造函数)。

## 0.13 方向 A：通用 crossLang 真仓 recall 硬化到生产级 — DONE（2026-06-13，全验证）
- **动机（§1.5 + goal 方向 A）**：Track 2（§0.11）只证了「3 真仓 0 假阳」,但那些仓**没有 Python 编排 subprocess 调本地脚本的模式** → 真 recall 信号缺失。本轮在真实仓上量 recall，把现有能力打到「装上就不想卸」的承重件。
- **方法（铁律①：真仓真命令）**：GitHub code search 找密集命中该模式的真实生信编排仓,clone 6 个(quarTeT/Tree2gd/ENCODE-long-rna-seq/drop + 既有 rna-seq-star-deseq2/nf-core/DESeq2),人工建 ground truth(逐 subprocess 调用点分 POSITIVE/NEGATIVE),索引后对账 general-crosslang 边。
- **真仓 recall 主战场 = `aaranyue/quarTeT`**：5 个真实 Python→兄弟脚本调用,**baseline recall 0/5**。实跑暴露**两个真实 recall 缺口**：
  1. **`{thisdir}/静态basename` f-string 族**：`subprocess.run(['python3', f'{sys.path[0]}/x.py'])`(数组 f-string,`f'` 前缀破 `["']` 锚 + `{sys.path[0]}` 含 `[0]` 不在字符类)、`subprocess.run(f'python3 {os.path.dirname(__file__)}/x.py')`(字符串 f-string,`cleanScriptPath` 不认 Python `{...}/` 前缀)。这是**真实世界最主流的「Python CLI 调兄弟脚本」惯用法**。
  2. **模块顶层 `__main__` 分派**：quarTeT 的 4 个分派在 `if __name__=='__main__':` **顶层**(argparse 入口分派),无 enclosing function → `enclosingFn` 返回 null → 全丢。这是**入口分派器**这一大类(绝大多数 Python CLI)的系统盲区。
- **修复(精度安全,`src/resolution/callback-synthesizer.ts`)**：① 共享 `SCRIPT_PATH` 子模式捕获插值块(`${...}`/`$var`/`{...}`)+ `SUBPROCESS_ARRAY_RE` 放开 `f'`/`r'`/`b'` 前缀;② `cleanScriptPath` 增剥 Python `{...}/` 目录前缀;③ **清洗后残留 `{}/$` 即 skip**(诚实天花板:插值 basename 如 `{prefix}.gen.R` 不编);④ 插值匹配**降置信 0.7**(目录是推断的);⑤ 无 enclosing fn 时**回退文件节点**(`callers(脚本)` 浮出编排文件,`line` 用调用行)。**quarTeT recall 0/5→5/5**(4 文件级 + 1 函数级),端到端 `callers quartet_assemblymapper.py`→`quartet.py` 打通。
- **对抗 Workflow(Ultracode 强制)又揪出 4 个真问题,各自实跑核后修**：
  1. **ReDoS(我自检发现,致命)**：`SCRIPT_PATH` 旧式 `(?:\$?\{[^}]*\}|[\w$./~-])+` 中 `$` 双归属 → `${}${}...` 无扩展名串 **2^N 回溯,实测 40 块耗 96990ms(97 秒)**,而此正则**每个源文件索引时跑** → 主进程冻结事故。改成**首字符互斥四分支** `(?:\$\{…\}|\$\w+|\{…\}|[\w./~-])+` → **0.10ms**,行为不变。
  2/3. **`check_call` 漏、`execFileSync`/`spawnSync` 漏**(召回怀疑者抓的真 FN)：`SUBPROCESS_ARRAY_RE` 调用名集缺 `check_call`(`call` 匹配不到 `check_call`)、`execFile` 后跟 `Sync` 在 `(` 前失配。统一成单一源 `SUBPROCESS_CALL_SRC`(含 `check_call`、`(?:Sync)?`、`CommandContext`、`execFile` 排在 `exec` 前)。
  4. **`echo`/straddle 假阳**(精度怀疑者抓 + 我自检确认)：`os.system("echo Rscript x.R")`(解释器是 echo 的参数,非被调进程)、`logging.info("...Rscript x.R")` 后跟无关 subprocess(120 字符 prefix 窗口**越界借** token)。两道闸:**① 命令边界门**(解释器左边非空白字符不能是词字符 `\w`,杀 `echo Rscript`);**② prefix 窗口在最近 `)` 处截断**(杀 straddle)。仅加在 general 合成器,不动已验证 workflow 路径。
  - **诚实怀疑者 0 发现**(6 例全对,含 `{sys.path[0]}/{module}.py` 插值 basename 正确零边、`{sys.path[0]}/realtool.py` 正确 0.7 边)→ 诚实天花板滴水不漏。
- **永久门禁(红→绿 + 有牙)**：fixture `polyglot-subprocess` 加 `dispatch.py`(f-string array/string + `dynamic_basename` 负样本)、`tool_sub.py`、pipeline.py 加 `run_via_check_call`/`echo_not_run`/`straddle_negative`、build.js 加 `buildReportSync`。harness 加 **`maxEdgeCount`** 字段(`types/scoring/runner.ts`)使**精度负样本有真牙**(echo/straddle `min0 max0`,否则过度连边仍全绿)。**polyglot 5→9 例,全 RED→GREEN**。
- **验收**：quarTeT recall 5/5;**6 个真仓 general-crosslang 0 假阳**(quarTeT 5TP/0FP,Tree2gd/ENCODE/drop/rna-seq/nf-core 全 0FP——字面量 `+` 拼接/绝对安装路径 `/usr/bin/MAD.R`/`os.sep.join` 输出脚本/数组首元素即脚本 全正确不编=诚实天花板);**20 eval 门禁全绿**(polyglot 9·capstone 5·workflow 4·deseq2 2);vitest **1490/1490**(mcp-daemon 那个 timing flaky 偶发,单独 3/3、与本改动 bisect 无关);workflow recall 不回归(snakemake 6/nf-core 7)。
- **已知诚实天花板(记录,不追)**：Node `child_process` **别名/解构导入**(`const cp=require(...);cp.execFileSync` / `const{execFileSync}=...`)需 dataflow 解别名,当前只认字面 `child_process.`;字面量 `'Rscript '+'x.R'` 拼接、`os.path.join(dir,var)`/变量路径——属静态不可解,留待真实 Node 仓证据驱动。
- **方向 A 第二部分:benchmark 跑真实大语料(§1.5 更强数字)— DONE**：`capability-matrix.ts` 加 **env-gated 真实大仓规模证据附录**(`OW_REALCORPUS=1` 才跑、repo 缺失则跳过 → **canonical `results/` 仍是 fixture-only 可复现**,CI 路径不变)。真仓数字:**quarTeT 5 跨进程 Python→脚本边 · DESeq2 DESeqDataSet 拥 10 分派方法/全图 15 S4 方法节点 · nf-core 7 跨语言 crossLang(覆盖 21 processes)· rna-seq 6 rule→脚本 + 61 artifact DAG 节点**,全部 1 次调用、亚毫秒~低毫秒、LSP 范畴性够不着。证明 §1.5 差异化非 fixture 造物,真实大仓规模成立。
- **改动文件**：`src/resolution/callback-synthesizer.ts`(SCRIPT_PATH/SUBPROCESS_CALL_SRC/两正则/cleanScriptPath/两道精度闸/文件回退/降置信)、`__tests__/evaluation/{types,scoring,runner,test-cases}.ts`(maxEdgeCount + 6 例)、`__tests__/evaluation/capability-matrix.ts`(真实大仓附录)、`__tests__/fixtures/polyglot-subprocess/{dispatch.py,tool_sub.py,pipeline.py,build.js}`。

## 0.11 Phase 3' Track 2 通用 crossLang（任意文件跨进程调用）— DONE（2026-06-13，全验证）
- **能力**：crossLang 从「仅工作流文件」泛化到**任意 Python/JS/TS/Go 文件**里 shell-out 到本地脚本——`subprocess.run/call/check_output/Popen`、`os.system/popen`、Node `child_process.exec/execSync/execFile/spawn`、Go `exec.Command`。边从**调用方函数节点**出发（`callees(fn)` 够到脚本、`callers(script)` 列出所有运行点）。这是脱离生信的**通用**跨进程跨语言能力，LSP 够不着。
- **实现**（`generalCrossLangEdges` in callback-synthesizer.ts，复用 `enclosingFn`/`cleanScriptPath`/`fileExists`/`crossLang` EdgeKind/`BRIDGE_EDGE_KINDS`——零新类型）：**两正则**——`SUBPROCESS_ARRAY_RE`（数组/分参形式，锚定 subprocess 调用名→0.85）+ 既有 `SHELL_INVOKE_RE`（扁平字符串形式）但**强制 prefix 含 `SUBPROCESS_CALL_RE`**（→0.8，否则 skip）。`isWorkflowFile` 跳过（不与 workflow 合成器重复扫）、comment-strip、interpolation/变量路径 skip（诚实天花板）、fan-out cap 8/函数。
- **对抗预审 3 bug，实跑核验后处置**：① **C1（真，已修）**：实测 `SHELL_INVOKE_RE` 不匹配 `subprocess.run(["Rscript","x.R"])` 数组形式（路径前是 `"` 非空白）→ 加 `SUBPROCESS_ARRAY_RE`，否则数组形式门禁假绿。② **C2（预审错，实测翻案）**：预审称 js/ts/go 注释剥离器清空字符串内容致零信号→**实跑证伪**（`stripCommentsForRegex` 只剥注释不剥字符串，`Rscript`/路径全保留）→**保留 JS/TS/Go 支持**。③ **C3（真，已修）**：裸串 `cmd="Rscript x.R"`/日志会假阳→把 `SUBPROCESS_CALL_RE` 从软标签升为**硬门**，消灭 0.65 垃圾档。
- **精度验证（实跑）**：fixture 恰 3 条 crossLang（run_analysis→deseq.R 0.85 数组 / make_report→report.py 0.8 字符串 / buildReport→report.py 0.85 JS），**`bare_ref` 裸串 + `dynamic` 变量路径零边**、top-level 零边。**真仓精度核验**：3 个真实仓库（rna-seq-star-deseq2 / nf-core-differentialabundance / DESeq2）的 Python/R/JS 文件产生 **0 条 general-crosslang 假阳**（这些仓没有「Python 编排 subprocess 调本地脚本」模式，硬门 + fileExists 正确不编造）——premortem #1「通用代码假阳污染」关切在真代码上解除。
- **eval**：fixture `__tests__/fixtures/polyglot-subprocess/`（py array + os.system + js + 裸串负样本 + 变量负样本），corpus `polyglot-subprocess`，3 例 RED(0/3)→GREEN(3/3)。**全量 vitest 1490/1490、capstone 5/5、workflow 4/4、deseq2 2/2；真仓 snakemake crossLang 仍 6（workflow=6/general=0，.py 脚本不调 subprocess）、nf-core 仍 7——0 回归。** 注：`mcp-daemon.test.ts` 有个 timing flaky 测试（daemon 死亡重连，bisect 证与本改动无关，重跑即过）。
- **改动**：`src/resolution/callback-synthesizer.ts`（+`generalCrossLangEdges` 及常量、wiring）、`__tests__/fixtures/polyglot-subprocess/{pipeline.py,build.js,scripts/*}`（新）、`__tests__/evaluation/test-cases.ts`（+3 例）。

## 0.9 Phase 2 交付前对抗 review + 加固 — DONE（2026-06-13）
并行跑 code-reviewer + silent-failure-hunter 审本轮全部 Phase 2 代码。核心逻辑（bridge 透传 BFS/DFS、template 正则、assertReachable hops、toKind 守卫、provenance 规则）全部判定正确。采纳 3 条加固，各自实跑验证后仍全绿：
- **精度**：`TEMPLATE_DIRECTIVE_RE`/`SHELL_INVOKE_RE` 可能命中注释行 → `workflowCrossLangEdges` 在切片后**剥离整行注释**（Snakemake/Python `#`、Groovy/Nextflow `//` `/*` `*`），防注释掉的指令编造边。探针实证：`// template 'ghost.R'` 无边、`template 'real.R'` 有边。
- **可观测性**：`resolution/index.ts` 合成 `catch {}` 原本静默吞错（Phase 2 加了两个会 throw 的合成器使其更危险）→ 改 `logWarn` 提示「部分合成边可能缺失」（stderr，MCP stdio 安全）。
- **门禁可调试性**：`assertReachable`/`assertEdges` 名字拼错时空节点集与真无路径输出无法区分 → `scoreAssertReachable` 在失败信息里**带上候选节点计数并提示 corpus/name/toKind mismatch**。**关键**：坚持**不**用「空节点集→config error 早返回」（silent-failure agent 的原建议），因为那会**掩盖** `toKind:'method'` 守卫要抓的 Track A 回归（method 节点消失→toNodes 空→必须 RED）——只改信息不改 pass/fail。
- 一处既有死变量 `expectedLower`（`scoring.ts` 的 `scoreFindRelevantContext`，非本轮引入、不进 tsc 主构建）按最小改动留置未碰。

## 0.7 Phase 2 ① 端到端三跳 trace + agent 可达性 — DONE（2026-06-13，全验证）
- **命题**：Phase 1 两棒的边能否**自动组合**成一条可导航的 polyglot 路径，证明 §1.5 差异化（LSP 够不着的跨进程+跨语言+动态分派）。**结论：能，且无需新抽取/解析代码**——两套边天然共享节点。
- **capstone fixture（已提交进库，不再用 /tmp）**：`__tests__/fixtures/capstone/`（`Snakefile` rule `fit_model:` script `scripts/model.R`；model.R **自定义** S4：setClass GeneModel + setGeneric fit/predict_expr + setMethod signature(object="GeneModel")）。索引后图中存在一条链：`fit_model(workflow-step) →crossLang(heuristic)→ model.R(file) →contains/calls→ fit(method, qn=GeneModel::fit) →overrides→ fit(function=generic)`，且 `GeneModel(class) →contains→ fit/predict_expr(method)`。
- **真 bug 发现并修复（agent 面向，最重要产出）**：`codegraph_explore`（main 主力「flow」工具）的 BFS `nodeKinds` 过滤用 `HIGH_VALUE_NODE_KINDS`(不含 `'file'`)，沿 crossLang 走到 file 节点时**静默丢弃** → crossLang 边 + file→method 边全消失 → agent 只拿到孤立的 `fit_model` 与 `fit`，**§1.5 能力对 agent 不可见**。**修法**：`src/graph/traversal.ts` 加 `BRIDGE_EDGE_KINDS={crossLang,produces,consumes}`，BFS/DFS 在「经 bridge 边到达」时放行 file/artifact 透传节点(其余结构边仍守 nodeKinds，不污染普通 explore)。实跑确认修后 explore 子图含 `fit_model --crossLang--> model.R --calls--> fit[method] --overrides--> fit[function]` 整链。**比 plan 的 tools.ts 一行更优**（避免全局 file 噪声、合 §1.5 token 经济 + 全局统一），边恢复用既有 `calls`（在 recoveryKinds 内）兜底连通、不需把 contains 加进恢复集。
- **永久 eval 门禁（hybrid，红门禁有牙）**：harness 新增 `assertReachable` api（复用既有 `cg.findPath`，BFS 出边沿 `reachableVia` 找最短路，hops=path.length-1）。4 例（corpus `capstone`）：3 个逐跳 `assertEdges`（诊断哪一棒回归）+ 1 个 `capstone-e2e-polyglot-chain` 复合可达性。**关键**：复合例带新字段 `toKind:'method'`，精确锁 `fit` 的 **S4 方法**节点而非同名 generic 函数——实测反事实证明若无 toKind、generic 也 2 跳可达会让门禁「绿但无意义」；有 toKind 则 Track A 一旦无 method 节点即 **RED**。这一例**无法**拆成逐跳 assertEdges（那些在 crossLang 落到错文件时仍全绿）。
- **§1.5 决策（Phase 2 ③）**：pipeline_dag/dispatch/trace_dataflow 三候选经三闸门审——全部在「token 经济」闸门失败（dispatch/trace_dataflow 省 0 次往返：`callees(class)`/`callees(step)` 已覆盖；pipeline_dag 仅省 1~2 次、边际不过 Occam）。**判定不加工具**，改在 `src/mcp/server-instructions.ts` 加提示（把 S4 多重分派 + workflow→脚本 crossLang 纳入既有 dynamic-dispatch 那句 + 一条 Common chains），零新表面、零维护负担。
- **改动文件**：`src/graph/traversal.ts`（bridge 透传）、`src/mcp/server-instructions.ts`（提示）、`__tests__/evaluation/{types,scoring,runner,test-cases}.ts`（assertReachable + 4 例）、新 fixture `__tests__/fixtures/capstone/{Snakefile,scripts/model.R}`。`.gitignore:48` 既有 `.codegraph/` 已覆盖 fixture 的索引产物（无需改）。
- **验收**：`EVAL_CORPUS=capstone npm run eval __tests__/fixtures/capstone` → 4/4。全量 `npx vitest run` 1490/1490。Phase 1 回归 DESeq2 2/2、Workflow 4/4 仍绿。
- **⚠️ 跑 capstone 门禁的前置（premortem Fix 2）**：eval 不自动索引，须先 `cd __tests__/fixtures/capstone && node <repo>/dist/bin/codegraph.js init -i` 再 `EVAL_CORPUS=capstone npm run eval __tests__/fixtures/capstone`，否则 runner 因无 `.codegraph/codegraph.db` 直接报错退出。

## 0.6 Phase 1·B crossLang — DONE（2026-06-13，全验证）
- **交付 §5 点名验收**「给定 rule/process 追到它调的 R/Python 脚本」：`callees deseq2`→R 脚本、`callers deseq2.R`→rule，双向可达。
- **架构（de-risk 实证后比 Understand 综合更 Occam）**：实验证明 Python grammar 解析 Snakefile 不级联失败、且 preParse 取不到 directive 原文 → **砍掉「新 snakemake Language + extractor + preParse」**。`.smk/.nf/Snakefile` 直接 tag `'python'`，一个 `workflowResolver.extract()`（`resolution/frameworks/workflow.ts`）regex 出 step 节点（`function` kind，id 前缀 `workflow-step:`）；crossLang 走 post-synthesizer `workflowCrossLangEdges`（callback-synthesizer.ts）读源码切片正则取脚本路径、剥插值、fileExists 后 emit，`provenance:'heuristic'`+confidence。
- **produces/consumes/DAG（同期补齐）**：加 EdgeKind `produces`/`consumes` + NodeKind `artifact`。`workflowResolver.extract()` 解析 `input:`/`output:` → `artifact` 节点（id **路径键合** `workflow-artifact:${path}`，生产者+消费者落同一节点=DAG 边）+ produces/consumes ref，`resolve()` 按路径匹配。结构边省 provenance。`callers "aligned/{sample}.bam"`→align(produces)+deseq2(consumes)，DAG 经标准工具可导航。
- **类型面**：3 个 EdgeKind（crossLang/produces/consumes）+ 1 个 NodeKind（artifact），涟漪进 RANK_EDGES/significantEdges/recoveryKinds/traversal 4 处。**未新增 Language**（.smk/.nf/Snakefile 复用 python grammar）。
- **eval**：受控真实语料 `/tmp/cg-probe/wf`，corpus `'workflow'`，6 例（crossLang×2 + produces + DAG-link）RED→GREEN。全量 1490/1490 过、0 回归；Track A deseq2 回归仍 2/2。
- **§1.5 形态约束印证**：Track A=动态分派、Track B=跨进程+跨语言（约束②）；crossLang/produces/consumes 全是「按关系铺」（约束③），未堆语言。

## 0.5 Phase 1·A — DONE（2026-06-13，全验证）
- **设计（比 §4 初版更 Occam，最终落地版）**：**不新造 `operatesOn`/`dispatches`**，复用 `contains`（class→method）+ `overrides`（method→generic，原是声明却未 emit 的 EdgeKind）。**无新 resolver 文件、无新 ReferenceKind、无 facade 改动。**
- **机理**：r.ts setMethod → `method` 节点 + dispatch 类编进 **qualifiedName=`Class::generic`**（Go `Recv::name` 同款，`createNode` 的 `...extra` 覆盖默认值）。新增 `rS4DispatchEdges`（`resolution/callback-synthesizer.ts`，结构同构 `goCrossFileMethodContainsEdges`）同目录(=R 包)按名解析两边，复用 `hasTypeParent` 守卫跳过 R6/ggproto 且增量幂等。
- **eval 门禁**：harness 加 `assertEdges` 变体 + `corpus` 标签 + `EVAL_CORPUS` 过滤（默认 elasticsearch 不动 Java 例）。`EVAL_CORPUS=deseq2 npm run eval /tmp/cg-probe/DESeq2`：RED(0/8,0/1)→GREEN(PASS,PASS)。
- **实测**：method 0→15、contains +15（DESeqDataSet=10）、overrides 0→4。全量 `npx vitest run` **1490/1490 过**。改动：`src/extraction/languages/r.ts`、`src/resolution/callback-synthesizer.ts`、`__tests__/evaluation/{types,scoring,runner,test-cases}.ts`、`__tests__/extraction.test.ts`。

> ⚠️ **§2-§4 里两处事实写错了（实跑核正）**：① **`Edge.provenance` 只有 `'tree-sitter'|'scip'|'heuristic'`——无 `'static'`**；结构确定边省略 provenance（confidence 进 `Edge.metadata`，无一等列）。② **`Node` 无通用 `metadata` 字段**→用 qualifiedName 编码 owner。③ DESeq2 setMethod 写法是 `signature(object="X")`（非裸字符串），本地 setGeneric 仅 8 个。

## 1. 工作基座（已就位，别重 clone）
- **项目根 `~/Desktop/develop/sogen/OmniWeave/` 本身就是 colbymchenry/codegraph 的 clone**，分支 `main`；已发布到 **`SolvingLab/OmniWeave`**（remote `origin`，私有）；remote `upstream` = colbymchenry/codegraph（**绝不 push upstream**）。
- 上游 CLAUDE.md → 存为 `docs/UPSTREAM-CLAUDE.md`（它详述基座代码结构，开发时必读）。我们的 `CLAUDE.md` + `OmniWeave-design-v1.md` + 本文件在根。
- 已 `npm install && npm run build` 跑通（本机 Node v22.22.3 满足 `node:sqlite`）。**commit 铁律：禁止任何 AI 署名 / `Co-Authored-By: Claude` / `Generated with` 水印（见 CLAUDE.md 顶部）。**
- 命令：构建 `npm run build`（tsc + copy-assets 拷 schema.sql 与 vendored `tree-sitter-r.wasm`）｜ 测试 `npm test`(vitest run) ｜ eval `npm run eval <indexed-repo>`（见 §4）｜ 跑本地产物 `node dist/bin/codegraph.js <cmd>`。

## 2. 实测真实基线（DESeq2，main 构建，全是跑出来的）
测试语料：`/tmp/cg-probe/DESeq2`（`thelovelab/DESeq2`，S4 重灾区：`AllClasses.R`/`AllGenerics.R`/`methods.R` 分三文件）。复现：
```bash
cd /tmp/cg-probe/DESeq2 && rm -rf .codegraph
node ~/Desktop/develop/sogen/OmniWeave/dist/bin/codegraph.js init -i   # 49 文件/292 节点/1333 边
sqlite3 .codegraph/codegraph.db "SELECT kind,COUNT(*) FROM nodes WHERE language='r' GROUP BY kind;"
  # function 186 / file 47 / import 27 / variable 10 / class 3  —— method=0
sqlite3 .codegraph/codegraph.db "SELECT DISTINCT kind FROM edges;"
  # calls / contains / imports —— 无 operatesOn、无 dispatches、无 extends
```
DESeq2 真实 S4 面：setClass×3 / setGeneric×8 / setMethod×15。**gap：method 节点=0、operatesOn=0、dispatches=0、extends=0。** R6/R5/ggproto 的 list 方法已是 `method` 类型（`r.ts: emitMethodArg`），**唯独 S4 `setMethod` 路径只 `createNode('function',…)`** —— 这是 Phase 1·A 第一刀的精确落点。
> 注：用户日用的发布版 **0.9.8 对 R 是 0**（bundle 无 r.js，只索引 .cpp）；R 是 main 才有的（issue #828）。

## 3. 抽取/解析机理（实测校正，写代码前必须用这些）
- 抽取**无 `.scm`**，每语言一个手写 TS `LanguageExtractor`（`src/extraction/languages/<lang>.ts`）+ `visitNode(node, ctx)` hook。R（`r.ts`）因「一切皆表达式」全走 visitNode。
- `ExtractorContext` API：`ctx.createNode(kind, name, node, {signature?})`、`ctx.addUnresolvedReference({fromNodeId, referenceName, referenceKind, line, column})`、`ctx.pushScope(id)/popScope()`、`ctx.visitNode(child)`、`ctx.nodeStack`、`ctx.source`。
- schema（`src/db/schema.sql`）：`edges(source,target,kind,**metadata** JSON,line,col,**provenance** 一等列)`；`nodes.kind`/`edges.kind` 是**自由文本**（加 `method`/`operatesOn`/`dispatches` 无需改枚举，落库即所写）。`unresolved_refs(from_node_id,reference_name,reference_kind,candidates,file_path,language)`。
- resolution 两段式：抽取 emit `unresolved_refs` → `src/resolution/index.ts` 用 `name-matcher` + `import-resolver` 解析成 `edges`。**`import-resolver` 的 `EXTENSION_RESOLUTION` 无 `r`、无 R 专属 resolver。**

## 4. Phase 1·A —— S4/R6 分派图（证据驱动、外科手术）
**先做 eval 门禁（红→绿纪律）**：基座 eval harness（`__tests__/evaluation/{runner,scoring,test-cases,types}.ts`）只支持 `searchNodes`/`findRelevantContext` 两类、**无边断言**。第一步给它加一类 **dispatch 断言用例**（断言某 class 的 `operatesOn` 入边数 / `method` kind 数），把当前基线 0 锁成红色门禁。查 `src/index.ts` 的 CodeGraph 程序化 API 找暴露边的方法（getCallers/getCallees/getImpactRadius/… 或需补一个 getEdgesByKind）。
**再改抽取**：`r.ts` 的 `GENERIC_FNS`(setMethod/setGeneric) 分支：`setMethod("x","Class",fn)` → `createNode('method',…)` + `addUnresolvedReference({referenceKind:'operatesOn', referenceName:'Class'})` + `{referenceKind:'dispatches', referenceName:'x'}`；S4 多签名 `signature=c("A","B")` → 多条 operatesOn；`setGeneric` 标 generic。S3 点命名 `print.myClass` 拆末个已知 generic/class，带 `confidence<1`。
**再补解析**：新 `src/resolution/r.ts`，把 operatesOn/dispatches 在**同包命名空间**（一个 R 包所有 `R/*.R` 共享命名空间——这才是 R 跨文件真实机制，不是 source()）按名解析成 `edges`，`provenance:'static'`。挂进 `resolution/index.ts`。
**一致性先验**（重要，Occam）：动手前先查基座有没有现成的「method 属于 type」边约定（如 `contains`/`references`/`memberOf`、C++ `return_type` receiver 推断、Swift/ObjC bridge）——**能复用就别新造 `operatesOn`**。这是新会话该跑的第一个 Understand workflow 的核心问题。
**验收**：`operatesOn DESeqDataSet`→15 方法；`method` kind≥15；dispatches 把 8 泛型各自方法簇连通。多重分派同构（Julia `::T`/C++ 重载/Go interface）→ 证明通用。

## 5. Phase 1·B（并行）—— 跨进程工作流数据流
基座完全没有。新增 `src/extraction/languages/{snakemake,nextflow}.ts`（grammar 不成熟则学基座 `svelte-extractor`/`liquid-extractor` 走正则 fallback）+ `src/dataflow/`：step 的 input/output → `DataArtifact` + `produces`/`consumes`；script 体里工具调用 → `Tool` + `invokes`；`Rscript x.R`/`python y.py` → `crossLang` 边并对目标脚本调基座既有 extractor 子解析，缝合 workflow 图与代码图。**每条边带 confidence+provenance**，动态拼接路径标 heuristic/低置信。语料：一个 nf-core 流水线 + 一个 snakemake-workflows。验收：给定 process/rule 能追到它最终调的 R/Python 函数。

## 6. 后续阶段（路线图见设计文档 §12）
- **Phase 2 ①（端到端三跳 trace + agent 可达性）— DONE**，见 §0.7。
- **Phase 2 ③（专用 MCP 工具）— 已判定不加**（§1.5 token 经济闸门），改 server-instructions 提示，见 §0.7。
- **Phase 2 ②（真实大语料压测）— DONE**，见 §0.8（recall/precision 双 100%，补上 nf-core `template` 机制）。
- **Phase 3（下一步）** 领域包（bio_nodes/links/edam_concepts；EDAM 用 URI 不用 label）。**关键纪律：先用 eval 证明 agent 真受益再投入**——领域包是「stronger」线，但 §1.5 怀疑「图天然更好」是信仰，必须 eval 数字说话。先想清楚：一个 coding agent 在什么真实任务上，因为知道某 R 函数 ↔ EDAM operation / bio.tools 条目而做得更好？没有可量化的 agent 受益场景就别堆三张表。建议先做一个最小 eval 用例（agent 任务 + 有/无领域包的对比），红→绿门禁证明，再决定投入规模。
- **Phase 4** 语义层（pyright/R languageserver 按需消歧、缓存，离热路径）+ Perl。

## 7. 不可妥协的纪律
- **eval 数字门禁**：每阶段设具体数字门，未达标不进下一阶段。先红后绿。
- **provenance + confidence**：每条非语法边带 `provenance`(static/heuristic/lsp)+`confidence`，MCP 透传给 agent。**准 = 不给 agent 一条它以为可信、实则编造的边。**
- **诚实天花板**：S4 运行时分派/NSE/environments 静态不可解 —— 只抽声明不抽分派。
- **Ultracode**：实质步骤用 Workflow 编排（Understand→Design→Implement→Review 各一个），对抗式验证发现的每条结论。对齐 OpenAI/Google 头部工程水准。
- **只在真正决策点停下问用户**，其余自主推进直到「超级完美」。
