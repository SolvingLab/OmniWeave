# OmniWeave Agent A/B 证值 —— 后续作战手册（第三轮及以后，HANDOFF）

> 新会话：这是「OmniWeave 价值证值」长期任务的操作真相。读完本文 + `CLAUDE.md` + `OmniWeave-STATUS.md` + 本目录 `RESULTS.md` 与 `round2/RESULTS-round2.md` + 两个 memory（`omniweave-project`、`omniweave-agent-ab-eval`），即可接手。**铁律：看真实的东西，跑真命令读真源码，有输出才算数；rc=0 ≠ 成功（首跑曾全 401 空跑还 rc=0）。**

## 0. 这个任务在干嘛

用 `agent-eval` harness 做 with/without OmniWeave 的端到端 agent A/B，**用 eval 数字（不是信仰）量化 OmniWeave 对 coding agent 的真实价值**，反向定位「下一步砸形态还是砸能力」。目标是把证据做到「超级完美」——见 §6 验收标准。

## 1. 两轮已做完的结论（价值曲线，别重测）

16 个 headless run，4 仓（DESeq2 / quarTeT / ky / dplyr），sonnet/high，唯一变量=是否挂 OmniWeave MCP：

| 题型 | 正确性 | 工具效率 | 成本 |
|---|---|---|---|
| 单点定位（轮1） | 4/4 平手 | 省 45% | **贵 44%**（MCP 形态税：ToolSearch 门控+schema 注入） |
| 反向/多跳/动态分派（轮2） | 3/4 平手，仅 DESeq2 反向全集 with 更优 | **省 53%** | **便宜 16%**（反转） |

**核心规律**：价值随查询复杂度单调上升——越反向/多跳/跨进程，OmniWeave 努力+成本双赢；越单点字面，grep 越能打、形态税越刺眼。
**护城河定位**：现阶段是「效率/成本」，**不是「正确性独占」**——中小仓（≤450 文件）grep+Read 暴力扫韧性极强，8 题里仅 1 题 OmniWeave 正确性明显拉开（DESeq2 列全 16 caller 含测试，grep 漏 6 处测试 caller）。

## 2. 待办路线（按序，每阶段 eval 数字门禁，不达标不进下一阶段）

> **✅ 第三轮已完成（2026-06-14）——阶段 A + 阶段 B 全部交付，§6 五条验收全达成。结果见 `round3/RESULTS-round3.md`。**
> - **阶段 A（大仓）DONE**：django(3,005) + vscode(11,538) 反向全集+impact。**§6.1 答案 = 大仓上正确性「不」拉开代差**——
>   greppable 唯一名题上 grep 暴力读 3k→11k 文件仍完整；护城河=效率/成本/时间/token 且随规模单调放大（vscode 省 96% 工具/76% 成本/12× token）。
>   正确性要拉开需结构不可 grep 的题（歧义名运行时分派/跨进程/transitive）。guava 弃用=可判性(歧义名+超高扇入)，非 Java 缺陷(MCP 工具实测正常)。
> - **阶段 B（形态税）DONE**：ToolSearch 税=+1turn/~5s、美元被缓存主导(冷/暖差56×)，**round-1「贵44%」修正为伪影**；
>   禁用 deferral(`ENABLE_TOOL_SEARCH=auto:100`)去掉那 1 往返但稳态省钱微乎其微。**真·形态优化=输出精度**：
>   实施 qualified_name 修复(`src/mcp/tools.ts` +23/-5，callers/callees 输出补 owning class)，django 类归属 9/12→12/12、零回归(vitest1490+eval capstone10/polyglot9/deseq2 2)，**未 commit 留工作区**。
> - **建议**：砸形态(输出精度+查询路由) > 砸能力(边已够) > 垂直闭环(维持 NO-GO)。
> - **下一轮真缺口（若继续）**：结构不可 grep 的题型（歧义名运行时具体分派目标 / transitive impact 闭包 / 跨进程多跳）——
>   唯一可能让正确性拉开代差的场；现有三档证据未覆盖。

### 阶段 A —— 第三轮大仓（最高优先，最大证据缺口）【✅ DONE，见上】
两轮都用中小仓，grep 还没到「噪音淹没+Read 预算爆炸」临界点。**大仓是 OmniWeave 正确性能否拉开的唯一未验证场，也是 README 最需要的承重数字。**
- 仓（corpus.json 已有，或直接喂 audit.sh）：**django ~2700 / guava ~3000 / vscode ~10000**；可加大型 R 仓（如 Bioconductor 大包）。
- 题型：复用第二轮的反向 callers / 多跳 / 全集枚举（grep 结构性弱项），针对大仓设计——重点是**全集完整性**（大仓 grep 最容易漏）和**深反向链**。
- 假设：大仓上 grep 会漏/被噪音淹，OmniWeave 正确性拉开。**实测验证或证伪，都如实记。**

### 阶段 B —— 砸形态（降形态税）
单点题形态税是负债（轮1 贵 44%）。量化「砍 ToolSearch 门控 + MCP schema 瘦身 + token 预算感知裁剪输出」能降多少税，让简单题也 net-positive。参照设计文档 §1.5「Aider 进程内甜点区」三约束。先在 quarTeT/DESeq2 短题上量基线，改造后再 A/B 对比。
> 若阶段 A 证明大仓正确性拉开，B 的优先级与方式都要重估（那时形态优化是放大已验证优势，而非补救形态税）。

### 阶段 C —— 持续补强直到饱和
补题型（不可字面 grep 的边：动态分派具体 target、跨语言桥接）、补仓、补语言。每轮发现新缺口就补，直到证据「超级完美」（§6）。

## 3. 操作手册（照抄，避免重踩坑）

**致命陷阱（首跑教训）**：harness 内跑 `claude` 子进程**绝不要清 HTTP 代理 env**。`HTTP_PROXY=127.0.0.1:55779` 是 Claude Code harness 注入认证 bearer token 的本地代理；清掉它（误抄"清代理走 TUN"逻辑）→ 全部 run `401 authentication_failed` 空跑（0 tool/0 token/$0）但 shell rc=0。**修复=原样继承环境，一个 proxy 变量都别动。** 证据：`raw/console-firstrun-401.log`。

**跑 A/B**（复用已索引的仓，最快）：
```bash
AGENT_EVAL_OUT=/tmp/agent-eval-r3/<repo> MODEL=sonnet EFFORT=high \
  bash scripts/agent-eval/run-all.sh /tmp/omniweave-corpus/<repo> "<question>" headless
```
**全流程**（首次/换版本，会 build+link dev build→clone→wipe+reindex→A/B→restore）：
```bash
AGENT_EVAL_OUT=/tmp/agent-eval-r3/<repo> bash scripts/agent-eval/audit.sh local <name> <url> "<q>" headless
```
- **版本必须 local dev build**（global omniweave link 到本仓 dist；发布版对 R 是 0，跑 R 仓无意义）。`omniweave --version` 应是 0.1.0(main)。
- **model=sonnet effort=high 是 standing policy，别提高**（保证跨轮可比，CLAUDE.md/run-all.sh 注）。
- 大仓后台跑（`run_in_background`+`dangerouslyDisableSandbox:true`，要联网/build/调 API）；串行（audit.sh 会临时改全局 install，并行冲突）；每仓独立 `AGENT_EVAL_OUT` 否则 `/tmp/agent-eval` 互相覆盖。

**判对错（关键，自动解析不覆盖）**：`parse-run.mjs` 只给 tool 序列+cost，**不判对错**。必须：① 提取两 arm 最终答案（解析 jsonl 的 assistant text / result）；② 用 dev build 查 ground truth（`omniweave callers/callees/explore <symbol>`，在 `/tmp/omniweave-corpus/<repo>` 内跑）；③ 逐项对照判「全/漏/错」。领读信号=cost+tool/Read 计数（可靠）；raw token 受缓存干扰仅参考。
- CLI 注意：**`omniweave search` 子命令不存在**（用 `explore`/`callers`/`callees`/`node`/`impact`/`status`）；MCP 层才有 `omniweave_search` 工具。

**归档（四层资产，每轮照做）**：`eval-results/agent-ab-2026-06-13/round<N>/`：`RESULTS-roundN.md`（分析+逐仓判定+英文 README 素材）、`raw/<repo>/run-headless-{with,without}.jsonl`、`raw/console-roundN.log`、runner 脚本。**未 commit、未进 .gitignore，留工作区**（公开前由用户定）。/tmp 会被清，分析时立刻 cp 到 repo。

## 4. 诚实纪律（不可妥协）

- grep 追平就如实说「平手」，不许包装成「OmniWeave 独占」；OmniWeave 在更少工具/更低成本达到同等正确，本身就是价值，足够诚实地讲。
- 每条结论附原始数据路径，可复现可复核。
- agent 不盲信图是健康信号（ky 题 with arm 纠正了 OmniWeave 把 import 当 caller 的噪音）——记录这类，作信任度卖点。
- 题目要公平：必须是真实 agent 会问的架构题，不是「列出所有 setMethod」这种只有 OmniWeave 能答的 cherry-pick；without arm 要能尝试。

## 5. 全局铁律（CLAUDE.md）

- **commit/PR 绝不加任何 AI 署名/水印**（Co-Authored-By、Generated with…一律不加）。
- 只在用户明确要求时 commit；推送只 `origin`，绝不 `upstream`。
- Ultracode：实质步骤用 Workflow 编排 + 对抗式验证。

## 6. 「超级完美」验收标准（达成才算完成，否则继续循环）

1. **大仓正确性结论有了**：≥2 个大仓（≥2700 文件）的反向/多跳题 A/B 跑完、判对错，明确回答「大仓上 OmniWeave 正确性是否拉开代差」。
2. **形态税量化**：测出当前形态税大小 + 至少一项形态优化（ToolSearch 门控/schema 瘦身/输出裁剪）的前后 A/B 收益数字。
3. **价值曲线完整**：单点→反向/多跳→大仓 三档证据齐全，每档有正确性/工具/成本三维数字。
4. **README 素材成稿**：英文素材段覆盖三档，诚实标注边界（样本量、grep 追平的题、未测场景）。
5. **下一步明确**：基于全部证据，给「砸形态 vs 砸能力 vs 垂直闭环」的最终带数字建议。

每完成一阶段更新本目录 RESULTS + memory `omniweave-agent-ab-eval`，并在此文件勾掉对应 §2 阶段。**未达 §6 全部 5 条，不停。**
