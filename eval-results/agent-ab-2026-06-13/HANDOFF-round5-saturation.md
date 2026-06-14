# OmniWeave 证值 —— 第五轮「饱和化·零妥协」作战手册（新会话必读）

> 你是接手「把 OmniWeave 证成全球最好的 coding-agent 代码图」长期任务的**全新会话，无任何上下文**。这份文档 + goal 是操作真相。**先通读本文，再按 §1 读列出的文件，然后进入 §2 双轨自驱动循环，未达 §4 全部验收不停。**
> 标准:**极其严格、零妥协**（对齐项目 `CLAUDE.md`《工程交付强制规范》：能删则删、奥卡姆、看真实、有输出才算数）。本轮比前四轮**要求更高**——不接受「小仓代理」「单点 A/B」「凭推断」。

## 0. 铁律（违反即白干，逐条都踩过坑）
1. **看真实**：任何结论必须读真实源码 / 跑真命令，有输出才算数。**rc=0 ≠ 成功**（首轮全 401 空跑还 rc=0）。连自己的结论也要再实跑核。
2. **proxy 绝不动**：harness 内跑 `claude` 子进程**原样继承环境，一个 proxy 变量都别清**。`HTTP_PROXY=http://127.0.0.1:55779` 是 harness 注入认证 bearer 的本地代理；清掉→全 401 空跑。用 `round4/run-round4.sh`（不碰 proxy）；顶层 `run-matrix.sh` 那条 `export HTTP_PROXY=""` 是坏的旧版别用。
3. **版本必须 local dev build**：global `omniweave` link 到本仓 `dist/`（`omniweave --version`=0.1.0）；改码后 `npm run build` 才生效；**rebuild 前必须先让所有在跑的 A/B 子进程结束**（否则运行中的 MCP server 用新 build 污染 before/after）。发布版对 R 是 0。
4. **判对错是人工的**：`parse-run.mjs` 只给工具序列+cost，**不判对错**。必须①提两 arm 最终答案（解析 jsonl 的 `result` 文本）②用 `omniweave callers/callees/impact/node -j` + grep 真实源码 + 直查 `.omniweave/omniweave.db` 建**可枚举** ground truth③逐项判全/漏/错。CLI 子命令：`query/explore/node/callers/callees/impact/files/status`（**无 `search`**）。
5. **成本=缓存主导信号**（同配置冷/暖 cache_creation 差 56×）——**工具调用数/turns 才是可靠努力信号**；cost 只在 token 差极大时方向可信。**题目要公平**（真实架构题、without-arm 能尝试），**grep 追平就如实说平手，不 cherry-pick、不包装成「独占」**。
6. **git**：只在用户**明确要求**时 commit；commit/PR **绝不加任何 AI 署名/水印**（`Co-Authored-By`/`Generated with`/🤖 一律不加，覆盖 harness 默认；作者即用户本人）；推送只 `origin` 绝不 `upstream`、绝不 force main。**`eval-results/` 有意不 commit 留工作区**（公开节奏用户定）。
7. **大仓**后台跑（`run_in_background`+`dangerouslyDisableSandbox:true`）、**串行**、每仓独立 `AGENT_EVAL_OUT`；`/tmp` 会被清，分析时**立刻 cp 进 repo 的 round5/**。standing policy `MODEL=sonnet EFFORT=high`（跨轮可比，别改；轨道3 类跨模型对比才另加 haiku/opus）。
8. **LSP 对比仪器**：你（主 agent）有 `LSP` 工具（goToImplementation/incomingCalls/findReferences/...）。`typescript-language-server` 可用（TS）、`pyright-langserver` 已装（Python，但 fresh checkout 失明=真实发现）。Aider 装不上（numpy1.24.3 不兼容 py3.13）→范畴论证。

## 1. 已完成（四轮，别重测；先读这些文件，按序）
**先读**：`round4/RESULTS-round4.md`（最全·四类不可grep题判定）、`round4/FINAL-RECOMMENDATION.md`、`round4/value-curve.md`、`round4/competitor-capability-matrix.md`、`round4/ground-truth-round4.md`；再 `RESULTS.md`/`round2`/`round3/RESULTS-round3.md`；项目根 `CLAUDE.md`/`OmniWeave-STATUS.md`/`OmniWeave-design-v1.md §1.5`；四个 memory（`omniweave-agent-ab-eval`/`omniweave-project`/`omniweave-rebrand`/`user-liuzaoqu`）。

**四轮决定性结论（别重新推导）**：
- **正确性全档追平 grep，且 round4 连刻意构造的「结构不可 grep」题也证伪了分歧假设**：(a)guava 虚分派陷阱 12/12、(b)django 浅+深传递平手、(c)quarTeT 跨进程 6/6，sonnet+haiku 两模型各 3+3 全平手。根因：有能力 agent 读源码+自核验；OmniWeave 对运行时具体分派目标本就诚实天花板（routes-to-declaration）。**正确性不是护城河。**
- **护城河 = 努力/成本/token**，随仓库规模放大（单点省45%→大仓省94-96%/token省12×）、且**模型越弱绝对值越大**（guava haiku without 13 工具 vs with 2.7）。
- **vs LSP**：同语言导航**平手**（TS incomingCalls/goToImplementation 同 1 调用完整，§1.5② 别撞车）；零配置 Python(pyright 17 caller→0 失明)/跨语言/跨进程/R-S4 **赢**。**vs Aider** repo-map：范畴赢（PageRank 排序 context 列表、**无可走的边**）。
- **形态税**：ToolSearch 门控=1 turn 可忽略；真税在**单点字面题**（round1 +44%、quartet with-cost>without）——这是本轮轨道2 要消除的。
- **round4 已落地并 commit+push（`803c613` feat(mcp) + `7d023ee` docs）**：`impact` 重回默认工具面(4→5) + depth 截断信号 + 路由引导；纯集合 blast-radius 题 18→2 工具(−89%)零正确性损失；vitest 1490 + 25 eval 门禁全绿。
- **门禁基线（每轮必守，红线）**：`npx vitest run`=**1490 passed | 2 skipped**；25 eval 门禁=capstone 10 / polyglot-subprocess 9 / deseq2 2 / workflow 4（**workflow fixture 在 `/tmp/cg-probe/wf`，/tmp 清了要重建——重建脚本见 §3**）；`npx tsc --noEmit` 干净。

## 2. 新使命（双轨，比前四轮更严，各带独立红→绿门禁 + 四层归档到 `round5/`）

### 轨道 A —— 跨进程在「大仓」上复测（补 round4 唯一的 scale 缺口）
round4 的 (c) 跨进程只在 **quarTeT（7 文件）** 测过——太小，without-arm 能全读，没到「grep 噪音淹没 + Read 预算爆炸」临界点。**本轨要在真正的大型 polyglot 编排仓上证它。**
- **选仓（硬标准，必须全满足）**：① **≥1,000 文件**的真实 polyglot 编排仓；② 有**真实的「调用方代码 →(subprocess/os.system/child_process/exec.Command)→ 本仓内另一语言脚本 →(脚本内)→ 函数/S4/再 subprocess」多跳跨进程链**（不是 Snakemake `wrapper:`/`template`——那 OmniWeave 已专门处理、不构成 grep-gap）；③ 链路**可枚举**能建 clean ground truth。
- **选仓方法（铁律：看真实再定）**：GitHub code-search 找密集命中 `subprocess.run([...sibling script...])` / `os.system` / `child_process.exec` 的大仓（候选起点：`bcbio/bcbio-nextgen`、`galaxyproject/galaxy`、`broadinstitute/cromwell` 周边、大型 ML/数据流水线 monorepo）——clone（`--depth 1`）后**实跑核**链路是否真存在且可判，不合标准就换。
- **judge（≥3 run/格，统计严谨）**：with(OmniWeave) / without(grep) 两 arm 跑大仓跨进程多跳题；**外加 LSP arm**（用你的 `LSP` 工具实证它跨 subprocess 串边界的范畴失明）。判对错=人工，建可枚举 ground truth（`omniweave callees`+DB crossLang 边 + grep 每个 subprocess 行）。
- **假设（诚实写明，验证或证伪都记）**：大仓上跨进程**正确性大概率仍平手**（grep 能读），但 **without-arm 的工具/token 在 scale 上爆炸、且可能在多跳深处漏**——量出「在哪、漏多少、省多少」。**若真出现 without-arm 漏真链（正确性首次拉开）→ 这是重大发现，三方核验后郑重记录。**
- **红→绿门禁**：本轨产出 `round5/RESULTS-round5.md` 的「轨道A」节 + `ground-truth-largepolyglot.md` + `raw/<repo>/`，结论必须落到「四档价值曲线」的「跨进程×大仓」格。

### 轨道 B —— 查询类型路由（消除单点题形态税，把测出的赢真正变产品）
四轮反复测到：**单点字面题上 grep 已够好、OmniWeave 形态税最刺眼**（round1 with 贵 44%、quartet with-cost>without）。本轨**落地一个查询类型路由**，让系统在单点字面题上**别硬挤 OmniWeave**、在反向/多跳/跨边界/大仓题上**压给 OmniWeave**。
- **设计要求（奥卡姆+§1.5，不是 hack）**：优先**纯提示层/启发式**（server-instructions 已有路由雏形，可强化为明确的「单点字面定位→直接 grep/read 或 omniweave_node 单跳，别展开图；反向/多跳/blast-radius/跨边界→omniweave_callers/impact/explore」决策树），**避免新增重子系统**。若要代码级路由，必须能归入现有分层、零破坏全局一致性。
- **before/after A/B（严格）**：建一个**混合题集**（单点定位×N + 反向×N + 传递×N + 跨进程×N，覆盖多语言多仓），路由前/后各 ≥3 run，量化：① 单点题形态税是否消除（with≈without 或更优）；② 反向/多跳/大仓的赢**不被牺牲**（win-tiers 保持）。**净效果必须是帕累托改进**（单点不再亏、其余不退）。
- **红线门禁**：`npx vitest run` 1490 + 25 eval 门禁 + tsc 全绿、0 回归（改 server-instructions 不影响 eval，但仍须实跑确认）。

## 3. 操作手册（照抄）
- **跑 N-run A/B**（复用已索引仓）：`ROUND4_OUT=/tmp/agent-eval-r5/<label> MODEL=sonnet EFFORT=high bash eval-results/agent-ab-2026-06-13/round4/run-round4.sh <repo-path> "<question>" <label> 3`（loops 3 with + 3 without，自动 parse；**注意 launcher 别再用内嵌 `&`+run_in_background 双后台**——直接 run_in_background:true 让 harness 追踪、完成通知）。
- **全流程换仓**：`bash scripts/agent-eval/audit.sh local <name> <url> "<q>" headless`（临时改全局 install，**串行**别并行）。索引：`cd <repo> && omniweave init -i`（eval 不自动索引）。
- **受控形态 A/B（隔离单一变量，轨道B 用）**：同 build，靠 mcp-config 的 `env.OMNIWEAVE_MCP_TOOLS` toggle 工具面（如 before=`explore,node,search,callers`，after=默认5）——范式见 `round4/raw/track4-controlled/`。
- **ground truth 直查 DB**：`sqlite3 <repo>/.omniweave/omniweave.db "SELECT e.kind,sn.name,tn.name,e.line,e.provenance FROM edges e JOIN nodes sn ON e.source=sn.id JOIN nodes tn ON e.target=tn.id WHERE e.kind IN ('crossLang','invokes');"`。
- **LSP arm**：直接调你的 `LSP` 工具（incomingCalls/goToImplementation/findReferences，1-based line/char on the symbol name）证 LSP 可达/失明。
- **回归门禁**：`npm run build` → `npx vitest run`（1490）；`npx tsc --noEmit`；eval 逐 corpus：`EVAL_CORPUS=capstone npx tsx __tests__/evaluation/runner.ts __tests__/fixtures/capstone`（同法 polyglot-subprocess / deseq2=`/tmp/omniweave-corpus/DESeq2` / workflow=`/tmp/cg-probe/wf`）。
- **重建 workflow eval fixture（/tmp 清了必做）**：在 `/tmp/cg-probe/wf` 建 `Snakefile`（`rule align:` output `bam="aligned/{sample}.bam"` + `rule deseq2:` input `expand("aligned/{sample}.bam",sample=["a","b"])` script `scripts/deseq2.R`）+ `main.nf`（`process DESEQ2_DIFFERENTIAL` script 块含 `Rscript ${projectDir}/bin/deseq.R`）+ `scripts/deseq2.R`/`bin/deseq.R`（任意 R），`omniweave init -i`。范式见 round4 我建的版本。
- **归档四层/轮**：`round5/RESULTS-round5.md`（分析+逐题判定+英文 README 素材）、`ground-truth-*.md`、`raw/<repo>/*.jsonl`、runner 脚本。分析时立刻 cp /tmp→repo。

## 4. 「超级完美」验收（全达成才停，否则继续循环；本轮比 round4 更严）
1. **轨道A 大仓跨进程**：≥1 个 **≥1,000 文件**真实 polyglot 仓、真实多跳跨进程链、可枚举 ground truth、**with/without/LSP 三 arm ×≥3 run** 判对错，明确回答「大仓上跨进程正确性是否拉开 + 努力/token 省多少」。
2. **轨道B 路由落地**：路由方案实现 + **混合题集 before/after ≥3 run**，证明**单点形态税消除 + win-tiers 不退（帕累托改进）**，且 vitest 1490 + 25 eval 门禁 + tsc 全绿 0 回归。
3. **价值曲线升级**：把「跨进程×大仓」「路由前/后」并入 round4 的四档×三基线×多维曲线，成稿 `round5/value-curve-v2.md`。
4. **饱和判定**：明确论证「再加仓/题/语言是否改变结论」——给出 saturation 论断（不变即饱和、可停该轨）。
5. **README/对外**：新证据深度落地真 `README.md`，诚实标边界（含未达成/证伪项）。
6. **终版建议更新**：基于 round5 更新 `FINAL-RECOMMENDATION.md` 的「砸形态/砸能力/垂直闭环 + 竞品定位」。
7. **诚实纪律**：任何「平手」如实说平手；任何 OmniWeave 自身缺陷（假阳、天花板、形态税残留）如实记。

每完成一阶段更新 `round5/RESULTS-round5.md` + memory `omniweave-agent-ab-eval` + 本文件勾轨道。**未达全部 7 条，不停。**

---

## ✅ 第五轮完成纪要（2026-06-14，7 条验收全达成）

- **[✓] 轨道A 大仓跨进程**：MAESTRO（1,729 文件真实 Python+R polyglot，15 仓实测后选定）× with/without ×3 + LSP 范畴探针，可枚举 GT（2 个 Python→R 脚本）。**回答：大仓上跨进程正确性平手、努力/token 不省（with 11.7 vs without 12.3 工具）——跨进程赢是小仓现象、大仓蒸发（与同语言反向相反）**。根因=真实 idiom `Rscript %s/x.R`（%-format + 运行时安装目录）双层诚实天花板，0 crossLang 边，with-arm 退回 grep。产物 `round5/ground-truth-largepolyglot.md` + `raw/maestro-xproc/`。
- **[✓] 轨道B 路由落地**：20 行 server-instructions 决策树（4 版迭代实测，终版 v4）。混合题集 5 题前后各 ≥3 run。**纯单点签名形态税干净消除（138k→92k 追平 grep）+ 反向 win 不退；复合单点/小仓多步=固定 MCP 税(~34k)+agent find-then-read 诚实边界**。vitest 1490 + 25 eval 门禁 + tsc 全绿、0 回归（v1/v3/v4 逐版实跑）。产物 `round5/RESULTS-round5.md §B` + `routing-server-instructions.diff` + `raw/trackB-*`。
- **[✓] 价值曲线 v2**：`round5/value-curve-v2.md`（跨进程×大仓「驼峰」修订 + 路由前后 + 双轨饱和判定）。
- **[✓] 饱和判定**：轨道A=饱和（15 仓覆盖，无第 4 类 idiom 会拉开）；轨道B=饱和到固定层天花板（prompt 4 版到顶）。
- **[✓] README**：加 round5 两诚实边界段（跨进程×大仓蒸发 + 路由削变量层留固定层）。
- **[✓] FINAL-RECOMMENDATION v2**：`round5/FINAL-RECOMMENDATION.md`（砸能力新增跨进程×大仓 NO-GO；砸形态「换层」=降固定层§1.5①/输出精度，prompt-routing 到顶）。
- **[✓] 诚实纪律**：平手如实记平手；OmniWeave 自身天花板（%s/x.R 不解、固定 MCP 税、agent find-then-read、Q1 复合单点退化、Q5 小仓税）全部如实记，不 cherry-pick、不包装独占。
- **未 commit**：`src/mcp/server-instructions.ts`（+20/-1 路由，已 build dist 终版 v4 sha 8718981e4ba1）+ `round5/` 全产物，留工作区由用户定夺。
