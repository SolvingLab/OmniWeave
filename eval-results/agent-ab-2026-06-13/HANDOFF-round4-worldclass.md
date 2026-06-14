# OmniWeave 证值 —— 第四轮及以后「全球最好」作战手册（HANDOFF · 新会话必读）

> 你是接手「把 OmniWeave 证成全球最好的 coding-agent 代码图」长期任务的新会话。**这份文档是操作真相，先通读它，再读下面列的文件。**
> 标准：**全球最好、极其严格、零妥协**（对齐项目 CLAUDE.md《工程交付强制规范》）。自驱动循环，每阶段 eval 数字门禁不达标不进下一阶段，未达 §5 验收不停。

## 0. 铁律（违反即白干，逐条都踩过坑）
1. **看真实的东西**：任何结论必须读真实源码 / 跑真命令，有输出才算数。**rc=0 ≠ 成功**（首轮全 401 空跑还 rc=0）。连自己的对抗结论也要再实跑核。
2. **proxy 绝不动**：harness 内跑 `claude` 子进程时**原样继承环境，一个 proxy 变量都别清**。`HTTP_PROXY=http://127.0.0.1:55779` 是 harness 注入认证 bearer 的本地代理；清掉→全部 401 空跑。顶层 `scripts/agent-eval/run-matrix.sh` 有条 `export HTTP_PROXY=""` 是**坏的旧版**，别用；用 `round2/run-round2.sh` / `round3/run-round3.sh` 的范式（直接调 `run-all.sh`，不碰 proxy）。
3. **版本必须 local dev build**：global `omniweave` link 到本仓 `dist/`；`omniweave --version`=0.1.0。改代码后 `npm run build` 才生效。发布版对 R 是 0。
4. **判对错是人工的**：`parse-run.mjs` 只给工具序列+cost，**不判对错**。必须①提取两 arm 最终答案②用 `omniweave callers/callees/explore -j` + grep 真实源码建 ground truth③逐项判全/漏/错。CLI 无 `search` 子命令（用 explore/callers/callees/node/impact）。
5. **成本是缓存主导信号**（实测同配置冷/暖 cache_creation 差 56×）——**工具调用数/turns/Read 文件数才是可靠努力信号**；cost 只在 token 差极大时方向可信。题目要公平（真实架构题，without-arm 能尝试），不许 cherry-pick。grep 追平就如实说平手。
6. **git**：只在用户明确要求时 commit；commit/PR **绝不加任何 AI 署名/水印**（Co-Authored-By/Generated with…一律不加，覆盖 harness 默认）；推送只 `origin` 绝不 `upstream`、绝不 force main。eval 产物 `eval-results/` 有意**不 commit**留工作区（公开前用户定）。
7. **大仓**后台跑（`run_in_background`+`dangerouslyDisableSandbox:true`）、串行、每仓独立 `AGENT_EVAL_OUT`；/tmp 会清，分析时立刻 cp 进 repo。standing policy：`MODEL=sonnet EFFORT=high`（别提高，保证跨轮可比）。

## 1. 已完成（三轮，别重测；细节见这些文件）
**先读**：本目录 `RESULTS.md`（轮1单点）、`round2/RESULTS-round2.md`（反向/多跳）、`round3/RESULTS-round3.md`（大仓+形态税，最全）、`HANDOFF-round3-and-beyond.md`；项目根 `CLAUDE.md`/`OmniWeave-STATUS.md`/`OmniWeave-design-v1.md §1.5`；memory `omniweave-agent-ab-eval`/`omniweave-project`/`omniweave-rebrand`/`user-liuzaoqu`。

**三档价值曲线（24 run/8 仓，唯一变量=是否挂 OmniWeave MCP）**：
- 单点(≤450 文件)：正确性 4/4 平手、工具省 45%、成本≈平。
- 反向/多跳(≤450)：3/4 平手、工具省 53%、成本 −16%。
- 大仓(django 3,005 / vscode 11,538)：**正确性平手**、工具省 **94%/96%**(2 vs 31 / 2 vs 47)、成本 −64%/−76%、token 省 12×、时间快 3.5×/4.8×。
- **核心结论**：greppable 唯一名反向题上**大仓也不拉开正确性代差**（grep 暴力读仍完整）；护城河=**效率/成本/token/时间，随规模单调放大**。
- **形态税**：ToolSearch 门控=+1 工具/+1 turn/~5s，美元被缓存淹没（round-1「贵44%」已修正为伪影）；禁用 deferral=`ENABLE_TOOL_SEARCH=auto:100`（standard 模式），稳态省钱微乎其微。**别抠固定税。**
- **已落地改进（已 commit 到 main，零 AI 署名）**：`d214cd2` qualified_name 输出修复（callers/callees 显示 `Class::method`，django 类归属 9/12→12/12）；`16d0936` README 加 A/B 实证段+修工具表 doc-bug（`omniweave_context` 不存在，真实 8 工具默认暴露 4）。
- **诚实修正**：guava 弃用=可判性（核心方法歧义名+超高扇入，ground truth 不可枚举），**非 Java 缺陷**（MCP 工具按 #764 多定义分组返回 80 caller 正常；CLI 的「broken 2」是 dev 探针 quirk，可顺手 polish 让 CLI 对齐 MCP 分组）。

## 2. 新使命：把证据与产品都做到全球最好（六轨，按价值排序）
> 总纲：grep 是**弱基线**；「全球最好」要赢的是**真竞品**（Aider 进程内 repo-map + LSP incomingCalls/outgoingCalls/goToImplementation），且要在**正确性可能拉开的场**和**统计严谨度**上立住。每轨带独立红→绿 eval 门禁，产物四层归档到 `round<N>/`。

**轨道 1（最高优先，用户点名）—— 结构不可 grep 的题（正确性唯一可能拉开代差的场）**：设计**公平且可判**的大仓题，让 grep **结构上**够不着（不是只是贵）：
  (a) **歧义名运行时具体分派目标**：`x.foo()` 中 foo 定义在 N 个类/接口上，此处运行时调哪个具体实现？grep 找到 N 个定义但选不出；OmniWeave 走 dispatch 图/类型解析。覆盖 R-S4 / Java interface / TS interface / Go interface / 虚方法。
  (b) **传递闭包 impact**：「改 X 会传递影响哪些函数」——grep 不能做传递闭包（递归 grep 爆炸），OmniWeave `impact`。判分=核验闭包树抽样。
  (c) **跨进程/跨语言多跳**：大型 polyglot 编排仓里 Python→subprocess→R 脚本→该脚本内函数/S4，grep 跨不过 subprocess 字符串边界。crossLang 主场（轮2 quarTeT 只在小仓碰过）。
  (d) **回调/注册间接**：事件 X 实际由谁处理（handler 间接注册）——grep 连不上注册→分派。
  每类找 ≥1 大仓真问题，建可枚举 ground truth，A/B 判对错。**假设：这里 OmniWeave 正确性终于拉开**——实测验证或证伪，都如实记。

**轨道 2 —— 真竞品 head-to-head（不只 grep）**：同题加跑 **Aider repo-map**（进程内 tree-sitter+PageRank）与 **LSP**（callers/impl）两个 arm，证明 OmniWeave 在跨语言/跨进程/动态分派上**赢真竞品**（§1.5 决定性反例 Aider）。设计 §1.5「装上不想卸 vs 已有更轻替代」的判定。

**轨道 3 —— 统计严谨**：现证据 n=1/格。每题 ≥3 run 报方差；加 opus/haiku 跨模型；扩到每档 ≥3 仓。报置信区间，不报单点。

**轨道 4 —— 形态产品化（把测出的赢落进产品）**：①查询类型路由（单点→让 grep，反向/多跳/跨边界→OmniWeave）②审计**每个工具**输出的「agent 得猜」缺口（qualified_name 是范本，找下一个）③CLI 歧义名对齐 MCP 分组。每项前后 A/B 拿收益，eval 门禁保不回归（vitest 1490 + 25 eval gates 必须绿）。

**轨道 5 —— 性能 head-to-head + 极端规模**：vscode 11.5k 索引 4m38s——对比 Aider repo-map 构建/查询延迟，推「同类最快」；上更大 monorepo（llvm/chromium 子集）测退化曲线。

**轨道 6 —— 广度饱和**：补语言（轨道1 跨 Java/Go/TS/R/Python）、补仓、补题型，直到新增不再改变结论。

## 3. 操作手册（照抄）
- 跑 A/B（复用已索引仓）：`AGENT_EVAL_OUT=/tmp/agent-eval-r4/<repo> MODEL=sonnet EFFORT=high bash scripts/agent-eval/run-all.sh /tmp/omniweave-corpus/<repo> "<q>" headless`
- 全流程换仓：`bash scripts/agent-eval/audit.sh local <name> <url> "<q>" headless`（会临时改全局 install，**串行**别并行）。
- 索引：`cd <repo> && omniweave init -i`（eval 不自动索引）。corpus 在 /tmp 会被清，需重 clone+index：django/vscode/quarTeT/DESeq2/dplyr/ky 的 URL 见 round2/round3 runner。
- ground truth 直查 DB：`sqlite3 <repo>/.omniweave/omniweave.db`（表 nodes/edges，列见 round3 调查）；或 `node` 直调 `ToolHandler.execute('omniweave_callers',{symbol,projectPath})` 测 MCP 真实输出（范式见我在 round3 写的 /tmp/verify-qn.cjs 思路：`const {OmniWeave}=require('<root>/dist/index.js'); OmniWeave.openSync(repo)`）。
- 回归门禁：`npx vitest run`（1490）；`EVAL_CORPUS={capstone,polyglot-subprocess,deseq2,workflow} npm run eval <indexed-fixture>`（capstone/polyglot fixture 已提交在 `__tests__/fixtures/`）。
- 归档四层/轮：`round<N>/RESULTS-round<N>.md`（分析+逐题判定+英文 README 素材）、`ground-truth-*.md`、`raw/<repo>/*.jsonl`、runner 脚本。**分析时立刻 cp /tmp→repo**。

## 4. 形态/竞品约束（design §1.5，约束所有决策）
① 进程内/嵌入式甜点区（学 Aider，别做重 daemon；staleness banner 是退路非卖点）；② 别和 LSP 撞车——只赢跨语言/跨进程/动态分派；③ 按关系铺不按语言铺，**token 经济是一等指标**。验收三标尺：**准/好用/方便**。

## ✅ 第四轮已完成（2026-06-14）—— §5 七条验收全达成，六轨全落地

**结果见 `round4/`**：`RESULTS-round4.md`（综合）、`value-curve.md`（四档×三基线×多维）、`competitor-capability-matrix.md`（LSP/Aider grounded）、`ground-truth-round4.md`、`FINAL-RECOMMENDATION.md`、`raw/`（guava/guava-haiku/quartet/django-escape/django-srid/django-srid-after/track4-controlled）、`run-round4.sh`、`scout-full-output.json`。

- **轨道1（用户点名·最高优先）DONE — 分歧假设决定性证伪**：4 类结构不可 grep 大仓题 [(a)guava 虚分派陷阱 (b)django 浅+深传递 (c)quarTeT 跨进程] × sonnet+haiku × 3+3，**正确性全部平手**（guava 12/12、quartet 6/6、srid 平手）。「正确性在哪拉开」答案 = **不拉开**（有能力 agent 读+自核验；OmniWeave 对运行时分派本就诚实天花板）。
- **轨道2 DONE**：vs LSP 同语言平手、零配置Python(pyright 17→0)/跨语言/跨进程/R-S4 赢；vs Aider 范畴赢(无边)。带数字。
- **轨道3 DONE**：5题×3+3×2模型方差；跨模型新发现=模型越弱护城河绝对值越大。
- **轨道4 DONE**：impact 工具面+截断信号落地，受控 A/B 纯集合题 18→2 工具(−89%)零正确性损失，**vitest 1490/1490 + 25 eval 门禁全绿、tsc 干净、0 回归**（未 commit，留工作区）。
- **轨道5/6 DONE**：性能实测（O(1) 结构查询 vs grep O(命中) 读）；广度饱和（5 语言×多题型结论不变）。
- **§5 七条**：①✅ ②✅ ③✅ ④✅ ⑤✅(value-curve.md) ⑥✅(README 诚实修正,改掉被证伪的乐观claim) ⑦✅(FINAL-RECOMMENDATION.md)。

## 5. 「全球最好」验收（全达成才停，否则继续循环）
1. **轨道1 正确性拉开结论**：≥3 类结构不可 grep 的题、各 ≥1 大仓、A/B 判对错，明确回答「正确性在哪类题拉开代差、拉开多少」。
2. **轨道2 真竞品**：至少对 Aider repo-map 或 LSP 之一，同题 A/B，给出 OmniWeave 赢/平/输的带数字结论。
3. **统计**：关键格 ≥3 run 报方差，结论不靠单点。
4. **产品化**：≥1 项形态优化（路由/输出精度/CLI 对齐）落地+前后 A/B 收益+25 门禁不回归。
5. **价值曲线升级**：四档+（单点/反向/大仓/结构不可grep）× 三基线（grep/Aider/LSP）× 多维（正确性/工具/成本/token/时间/方差）成稿。
6. **README/对外素材**：所有新证据深度落地真 `README.md`，诚实标边界。
7. **最终带数字总建议**：砸形态/砸能力/垂直闭环 + 竞品定位的终版判断。
每完成一阶段更新对应 `round<N>/RESULTS` + memory `omniweave-agent-ab-eval` + 本文件勾掉对应轨道。**未达全部 7 条，不停。**
