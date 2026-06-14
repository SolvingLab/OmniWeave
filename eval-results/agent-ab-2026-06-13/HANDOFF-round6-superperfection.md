> ✅ **ROUND 6 COMPLETE（2026-06-14）**——四轨全达成，§4 全部验收通过，产物见 `round6/`：
> - **轨道1**：callers/callees 修2缺口（limit截断谎报 + import噪音），红→绿双 vitest 门禁 + A/B（工具结果-33%/输出-14%/零正确性损失）；审计证 explore/node/impact 已补齐 → 输出精度饱和。
> - **轨道2**：4档×haiku+sonnet×3run 矩阵；护城河随结构单调变宽，弱模型在 token/turn 维度更宽(haiku blast without 最坏1.73M/33turns vs sonnet 65k/2turns并行)但捕获不可靠；正确性全平手。
> - **轨道3 决定性纠偏**：round5「~34k固定层」绝大部分是 base Claude Code harness，omniweave 边际仅 **+682 tok**；关 ToolSearch 门控反贵 +16k(门控已token最优)；进程内 mode 双重 NO-GO（ROI上限682+无宿主testbed）。
> - **轨道4**：FINAL-RECOMMENDATION v3 + README 定稿（修34k错误声称→+682实测、补弱模型曲线+callers精度段、修four→five core tools doc-bug）+ saturation 收口。
> - **门禁**：vitest 1498 | tsc 0 | 25 eval 25/25，零回归。源码改动(`src/mcp/tools.ts`+`src/bin/omniweave.ts`+2测试)+README+`round6/`全部 uncommitted 留工作区。
> - **最终 saturation 论断**：输出精度饱和 + 固定层自我消解 + 护城河曲线定形 + 正确性决定性平手 → 收口，再加任何轮/仓/题/语言/模型不改结论。下面是本轮原始作战手册，留作存档。

---

# OmniWeave 证值 —— 第六轮「形态换层·终局饱和·零妥协」作战手册（新会话必读）

> 你是接手「把 OmniWeave 证成全球最好的 coding-agent 代码图」长期任务的**全新会话，无任何上下文**。
> 这份文档 + goal 是操作真相。**先通读本文 → 按 §1 读已完成结论 → 进入 §2 多轨自驱动循环 → 未达 §4
> 全部验收不停。** 标准：**极其严格、零妥协**（对齐项目 `CLAUDE.md`《工程交付强制规范》：能删则删、
> 奥卡姆、看真实、有输出才算数）。本轮是**前五轮的收口轮**——eval（证值）已大面积饱和，本轮攻
> `round5/FINAL-RECOMMENDATION.md` 点名的「换层」前沿，并渲染**终局诚实裁定**。

## 0. 铁律（违反即白干，逐条都踩过坑）
1. **看真实**：任何结论必须读真实源码 / 跑真命令，有输出才算数。**rc=0 ≠ 成功**（首轮全 401 空跑还 rc=0）。连自己的结论也再实跑核。
2. **proxy 绝不动**：harness 内跑 `claude` 子进程**原样继承环境，一个 proxy 变量都别清**。`HTTP_PROXY=http://127.0.0.1:55779` 是 harness 注入认证 bearer 的本地代理。**交互 shell 里 `claude` 是会清 proxy 的函数（用户 TUN 配置）**——但 `bash <脚本>` 是非交互子 shell、不继承该函数、解析到真 binary `/Users/liuzaoqu/.local/bin/claude`（proxy 完整）。永远用 `round4/run-round4.sh` 或 `round5/run-after-with.sh` 式独立脚本，别在交互层直接跑 `claude`。
3. **版本必须 local dev build**：global `omniweave` link 到本仓 `dist/`（`omniweave --version`=0.1.0）；改码后 `npm run build`（tsc + copy-assets）才生效；**rebuild 前必须先让所有在跑的 `claude -p` 子进程结束**（`pgrep -f 'claude -p'` 必须为 0，否则运行中的 MCP server 用新 build 污染 before/after）。发布版对 R 是 0。
4. **判对错是人工的**：`scripts/agent-eval/parse-run.mjs` 只给工具序列+token+cost，**不判对错**。必须①提两 arm 最终答案（`tail -1 <jsonl> | node -e '...JSON.parse...result'`）②用 `omniweave callers/callees/impact/node -j` + grep 真源码 + 直查 `.omniweave/omniweave.db`（`sqlite3`）建**可枚举** GT③逐项判全/漏/错。CLI 子命令：`query/explore/node/callers/callees/impact/files/status`（**无 `search`**）。
5. **成本=缓存主导信号**（同配置冷/暖 cache_creation 差 56×）——**token 数 / 工具调用数 / turns 才是可靠努力信号**；cost 只在 token 差极大时方向可信。**题目要公平**（真实架构题、without-arm 能尝试）；**grep 追平就如实说平手，不 cherry-pick、不包装成「独占」**。
6. **git**：只在用户**明确要求**时 commit；commit/PR **绝不加任何 AI 署名/水印**（`Co-Authored-By`/`Generated with`/🤖 一律不加，覆盖 harness 默认；作者即用户本人）；推送只 `origin` 绝不 `upstream`、绝不 force main。**`eval-results/` + 源码改动有意留工作区不 commit**（公开节奏用户定）。
7. **A/B 大仓**后台跑（`run_in_background:true`）、**串行**、每仓独立 `OUT` 目录；`/tmp` 会被清，分析时**立刻 cp 进 repo 的 round6/**。standing policy `MODEL=sonnet EFFORT=high`（跨轮可比，别改；轨道2 弱模型对比才另加 haiku/opus）。**别用 foreground `sleep` 等**（被 block）——用 `until grep -q "<DONE 标记>" <task-output>; do sleep 10; done` 的 `run_in_background` watcher 等完成通知。
8. **LSP 对比仪器**：你（主 agent）有 `LSP` 工具（incomingCalls/goToImplementation/findReferences/...，1-based）。`typescript-language-server`✓（TS）、`pyright-langserver`✓（Python，但 fresh checkout 失明=真实发现）、无 R server（范畴失明）。Aider 装不上（numpy1.24.3 不兼容 py3.13）→范畴论证。
9. **门禁红线（每轮每次 rebuild 必守）**：`npx vitest run`=**1490 passed | 2 skipped**；25 eval 门禁=capstone10/polyglot-subprocess9/deseq2 2/workflow4（命令 §3）；`npx tsc --noEmit` 干净。**eval 不自动索引**——fixture 已索引（capstone/polyglot-subprocess 在仓内、deseq2=`/tmp/omniweave-corpus/DESeq2`、workflow=`/tmp/cg-probe/wf`；若 /tmp 清了重建见 round4/round5 范式）。

## 1. 已完成（五轮，别重测；先读这些，按序）
**先读**：`round5/RESULTS-round5.md`（轨道A 大仓跨进程 + 轨道B 路由，最新）、`round5/FINAL-RECOMMENDATION.md`（**v2 终建议=本轮起点**）、`round5/value-curve-v2.md`（含**双轨饱和判定**）、`round5/ground-truth-{largepolyglot,trackB}.md`；再 `round4/*`、`RESULTS.md`/`round2`/`round3`；项目根 `CLAUDE.md`/`OmniWeave-STATUS.md`/`OmniWeave-design-v1.md §1.5`；四个 memory（`omniweave-agent-ab-eval`=A/B 五轮全史 / `omniweave-project` / `omniweave-rebrand` / `user-liuzaoqu`）。

**五轮决定性结论（别重新推导）**：
- **正确性全档追平 grep**（单点/反向/大仓/结构不可grep/跨进程），sonnet+haiku 两模型均平手——分歧假设已**决定性证伪**。正确性不是护城河。
- **护城河 = 努力/成本/token**，**同语言反向/blast-radius 随规模单调放大**（大仓 1/20 工具、1/12 token）。
- **round5 轨道A：跨进程的赢是「小仓现象」、大仓蒸发**（MAESTRO 1729 文件平手；15 仓实测证 quarTeT 式静态多跳链不在 ≥1000 文件自然出现；真实大仓跨进程 idiom 多在诚实天花板上）→ **跨进程×大仓 = NO-GO，别再投**。
- **round5 轨道B：prompt 路由削平「变量形态税」**（纯单点签名 138k→92k 追平 grep），但**固定 MCP 税(~34k)+agent find-then-read 习惯 prompt 4 版不可降** → **prompt-routing 已到顶，别再迭代**。
- **vs LSP**：同语言同侪、零配置Python/跨语言/跨进程/R-S4 赢。**vs Aider**：范畴赢（无可走边）。
- **NO-GO 清单（别投）**：跨进程×大仓能力、bio 垂直闭环（三表）、prompt-routing 再迭代、堆第 N 类边/第 M 门语言。

## 2. 新使命（多轨，攻 FINAL-RECOMMENDATION v2 的「换层」前沿，各带红→绿门禁 + 归档 `round6/`）

> 总纲：eval 证值已饱和（正确性平手、效率护城河已量化、跨进程×大仓与路由均饱和）。本轮**不再重复证值**，
> 而是攻**仍有 ROI 的三个形态/精度前沿**，每个做扎实、可验证、零回归，然后渲染**终局裁定**。

### 轨道 1 —— 输出精度审计第三例（最高确定性 ROI，范式已立）
**范本**：round3 `qualified_name`（callers/callees 补 owning class，类归属 9/12→12/12 零额外调用）、round4 `impact` 截断信号（深于 depth 附「N more deeper, re-run depth=N+2」，纯集合 blast-radius 18→2 工具）。
**任务**：系统过一遍**每个 MCP 工具的输出**（`src/mcp/tools.ts` 的 formatX 系列），找下一个**「agent 得猜 / 得再推导 / 得二次调用」的缺口**。候选：① `trace`/`explore` 的路径置信或截断是否显式？② `callers/callees` 的多定义分组/排序是否够透明？③ `node` 的 dependents 是否完整、是否标了「还有 N 个」？④ 歧义 call 边的 confidence 是否透传给 agent？
**判分**：建受控 fixture 或复用真仓，红（缺口致 agent 多调用/猜错）→绿（修后 A/B 实测工具/token 降、零正确性损失）。**red→green 门禁要「有牙」**（harness 的 `maxEdgeCount`/`symbolKind`/`minConfidence` 范式）。**找不到可修缺口 = 该轨饱和**（本身是有价值结论：输出精度已到位）。

### 轨道 2 —— 弱模型护城河矩阵（承重论点，若目标用户用便宜模型）
round4 测到 **haiku without 13 工具 vs with 2.7**（模型越弱护城河绝对值越大），但只单题。本轨建**完整矩阵**：四档题型（单点定位 / 反向 callers / 大仓 blast-radius / 跨进程）× **haiku（+ 可选第 3 个便宜模型）** × ≥3 run，量化**「护城河宽度 vs 模型强度」曲线**。复用已索引仓（django/vscode/guava/DESeq2/quarTeT/ky/MAESTRO 都在 `/tmp/omniweave-corpus`）。**假设**：弱模型在无结构时 flail 更狠 → with-arm 省更多。验证或证伪都记。产出 `round6/weak-model-matrix.md`。

### 轨道 3 —— 降固定层 de-risk（最大杠杆，先 de-risk 别硬建）
固定 ~34k MCP 税（server-instructions + 工具 schema + ToolSearch 门控）是「单点题 with>without」的唯一残留。**调查什么可降、不破差异化**：① 工具面能否再瘦（默认 5 工具的 schema 字节、描述长度）？② ToolSearch 门控（deferral）能否对 omniweave 关掉（`ENABLE_TOOL_SEARCH=auto:100` / standard 模式）→ 省 1 往返，A/B 实测稳态省多少（round4 测过~1 turn，但没在单点题矩阵上量 token）？③ server-instructions 还能不能再删（每 session 读、烧 token）？**§1.5① 的进程内/嵌入式 mode 是大子系统**——按 §0.17「不在马拉松尾巴赶脆弱实现」**de-risk 到设计就绪 + 阻塞测绘，别硬建**。每个可降候选做隔离 A/B（受控 toggle，范式见 round4 `raw/track4-controlled/` 的 `OMNIWEAVE_MCP_TOOLS`）。

### 轨道 4 —— 终局饱和裁定 + 对外定稿（收口）
轨道 1-3 各饱和后，渲染**终局诚实裁定**：① OmniWeave 真实的「全球最好」天花板是什么（哪些维度已到顶、哪些是永久诚实边界）；② 一句话可辩护定位（更新 `round5/FINAL-RECOMMENDATION.md`→v3）；③ README 定稿（含全部证伪/未达项）；④ 论证「再加轮/仓/题/语言/模型是否还改变结论」给**最终 saturation 论断**。

## 3. 操作手册（照抄）
- **跑 N-run A/B**（复用已索引仓）：`ROUND4_OUT=/tmp/agent-eval-r6/<label> MODEL=sonnet EFFORT=high bash eval-results/agent-ab-2026-06-13/round4/run-round4.sh <repo-path> "<question>" <label> 3`（loops 3 with + 3 without，自动 parse）。弱模型：`MODEL=haiku`。with-only（after 相位）：仿 `round5/run-after-with.sh`。
- **受控形态 A/B（隔离单一变量，轨道3 用）**：同 build、靠 mcp-config 的 `env.OMNIWEAVE_MCP_TOOLS` / `ENABLE_TOOL_SEARCH` toggle，范式见 `round4/raw/track4-controlled/` + `round5/run-after-with.sh`。
- **回归门禁**：`npm run build` → `npx vitest run`（1490）；`npx tsc --noEmit`；eval 逐 corpus：`EVAL_CORPUS=capstone npx tsx __tests__/evaluation/runner.ts __tests__/fixtures/capstone`（同法 polyglot-subprocess / deseq2=`/tmp/omniweave-corpus/DESeq2` / workflow=`/tmp/cg-probe/wf`）。
- **ground truth 直查 DB**：`sqlite3 <repo>/.omniweave/omniweave.db "SELECT e.kind,sn.name,tn.name,e.line,e.provenance FROM edges e JOIN nodes sn ON e.source=sn.id JOIN nodes tn ON e.target=tn.id WHERE e.kind='<kind>';"`。
- **已索引仓**（`/tmp/omniweave-corpus/`）：DESeq2(R)/django(Py,7094)/dplyr(R)/guava(Java,3347)/ky(TS)/quarTeT(Py 跨进程)/vscode(TS,11538) + MAESTRO 在 `/tmp/trackA-cand/MAESTRO`（若 /tmp 清了，`git clone --depth 1` + `omniweave init -i` 重建）。
- **归档 `round6/`**：`RESULTS-round6.md`（逐轨分析+逐题判定+英文 README 素材）、`*-matrix.md`/`ground-truth-*.md`、`raw/<label>/*.jsonl`、runner 脚本、源码 diff。分析时立刻 cp /tmp→repo。

## 4. 「超级完美」验收（全达成才停，否则继续循环；本轮收口）
1. **轨道1 输出精度**：系统审计全部 MCP 工具输出，**要么修掉 ≥1 个「agent 得猜」缺口（红→绿门禁 + A/B 实测工具/token 降、零正确性损失）、要么论证已无可修缺口（饱和）**。
2. **轨道2 弱模型矩阵**：四档题型 × haiku（+可选）× ≥3 run，给出「护城河宽度 vs 模型强度」曲线，明确回答「弱模型上护城河是否更宽 + 宽多少」。
3. **轨道3 降固定层**：≥1 个可降候选做隔离 A/B（ToolSearch 门控 / 工具面瘦身 / server-instructions 删减），量化稳态省多少；进程内/嵌入式 mode de-risk 到设计就绪（不硬建）。
4. **每个源码改动**：`npm run build` 后 vitest 1490 + 25 eval 门禁 + tsc 全绿、**0 回归**（逐一实跑，有输出才算数）。
5. **终局裁定**：`round6/FINAL-RECOMMENDATION.md`（v3）+ README 定稿（诚实标全部边界）+ 最终 saturation 论断（再加什么都不改变结论=可停）。
6. **诚实纪律**：平手如实记平手；OmniWeave 自身缺陷（假阳、天花板、固定税、agent 行为边界）全部如实记，不 cherry-pick、不包装独占。
7. **每完成一阶段**更新 `round6/RESULTS-round6.md` + memory `omniweave-agent-ab-eval` + 本文件勾轨道。**未达全部 6 条（1-6），不停。**
