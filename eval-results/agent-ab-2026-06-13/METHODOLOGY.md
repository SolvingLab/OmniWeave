# OmniWeave Agent A/B 证值 —— 方法学与可复现操作记录

> 这份文档是**对外证据资产**的操作底稿:记录"怎么跑出来的"，使每个数字可复现、经得起 review。
> 结论与数据见同目录 `RESULTS.md`；原始 stream-json 见 `raw/<repo>/`。
> 公开（写进 README / 上传）前由作者决定裁剪范围——本目录默认仅工作区持久保存，未 commit。

## 1. 这次回答的承重命题

设计文档 §1.5 的灵魂问题不是"图里有没有独特的边"（能力矩阵 `npm run benchmark` 已证，见 `__tests__/evaluation/capability-matrix.ts`），
而是**"coding agent 真的装上 OmniWeave 之后，把活干得更好/更省/更准了吗？"**——以及反过来：

- 在 OmniWeave 差异化最强的场景（R S4 分派、polyglot 跨进程），agent 是否因此**少绕路、少 token、答得更准**？
- 在 OmniWeave 不该占优的中性场景（纯单语言 TS），挂上 MCP 是否反而带来**"形态税"**（多一层工具、绕路、token 变肥）？
- 在 OmniWeave 静态解不了的天花板场景（R NSE），它是**诚实地帮不上**，还是**误导**（给低置信/错边把 agent 带歪）？

这三问的答案，直接反向定位下一阶段该砸"形态"还是砸"能力"。

## 2. 被测对象与环境（钉死，可复现）

| 项 | 值 |
|---|---|
| OmniWeave 版本 | **local dev build**（含 Phase 0–4 全部能力；发布版对 R 是 0，跑 R 仓无意义，故绝不用发布版） |
| 代码版本 | git `5589122`（main，工作区 clean） |
| dist | `dist/bin/omniweave.js`（`npm run build` 产物） |
| 机器 | macOS（darwin 25.5.0）、Node v22.22.3（满足 `node:sqlite`）、Clash Verge TUN |
| Agent | `claude` CLI v2.1.177，headless `claude -p`，`--output-format stream-json` |
| 模型/努力 | **model=sonnet, effort=high**（standing A/B policy，CLAUDE.md 规定不提高——保证可比） |
| 预算闸 | `--max-budget-usd 4` / arm |
| 日期 | 2026-06-13 |

## 3. A/B 设计（唯一变量 = OmniWeave）

两个 arm 都是同一条 `claude -p` headless，**唯一区别是 MCP 配置**（`--strict-mcp-config`）：

- **with** — 只挂 OmniWeave MCP：`{"mcpServers":{"omniweave":{"command":"<dist>","args":["serve","--mcp","--path","<repo>"]}}}`
- **without** — 空 MCP：`{"mcpServers":{}}`

两边**都保留**内置 `Read` / `Grep` / `Bash`。即 `without` arm = 纯 agentic search（grep/read），这正是 Claude Code / opencode 的原生形态，是 OmniWeave 真正要击败的基线。

索引由**同一 dev build** 在每次运行前 `wipe + reindex` 重建（`rm -rf .omniweave && omniweave init -i`）——索引必须由服务它的同一二进制构建。

## 4. 语料矩阵（4 仓，含防 cherry-pick 对照 + 主动自曝短板）

| # | 仓 | 角色 | 为什么选 | 预期 |
|---|---|---|---|---|
| 1 | `thelovelab/DESeq2` | **S4 分派旗舰** | OmniWeave Phase 1·A 就为它做；setClass/setGeneric/setMethod 三文件，S4 分派图 grep+LSP 范畴性够不着 | OmniWeave 该赢 |
| 2 | `aaranyue/quarTeT` | **polyglot 跨进程旗舰** | Phase 3' §0.13 真仓 recall 主战场（Python subprocess→兄弟脚本，0/5→5/5 硬化过） | OmniWeave 该赢 |
| 3 | `sindresorhus/ky` | **纯 TS 中性对照** | 单语言、~25 文件、无跨边界/无动态分派——OmniWeave 差异化用不上 | 应持平；检验"形态税" |
| 4 | `tidyverse/dplyr` | **NSE 天花板自曝** | dplyr 重度 NSE，OmniWeave 明示静态不可解（诚实天花板） | 可能不赢；检验是否"诚实帮不上"而非"误导" |

### 各仓 question（与 runner 完全一致，原文）

1. **DESeq2** — *In DESeq2, when estimateDispersions() is called on a DESeqDataSet object, which S4 method implementation runs (the setMethod for that signature), and what does that method call or dispatch to next? Name the generic, the DESeqDataSet method, and the next call in order.*
2. **quarTeT** — *In quarTeT, the command-line entry dispatches subcommands that run other Python scripts as subprocesses. For the AssemblyMapper subcommand, which sibling .py script does it ultimately invoke, and from which function/file? Name the orchestrating file/function and the target script.*
3. **ky** — *How does ky implement request retries and timeouts?*
4. **dplyr** — *When mutate() is called on a grouped data frame in dplyr, which functions handle the grouping and expression evaluation, in order, from mutate() down? Name the key functions on the path.*

> question 都是**真实 agent 会问的架构理解题**，不是"列出所有 setMethod"这种只有 OmniWeave 能答的 cherry-pick 查询——`without` arm 用 grep 同样可以尝试，比的是**谁更少绕路、更省 token、答得更准**。

## 5. 复现命令

```bash
# 单仓（harness 会 build+link dev build → clone → wipe+reindex → with/without A/B → restore dev link）
AGENT_EVAL_OUT=/tmp/agent-eval/DESeq2 MODEL=sonnet EFFORT=high \
  bash scripts/agent-eval/audit.sh local DESeq2 https://github.com/thelovelab/DESeq2 "<question>" headless

# 全矩阵（串行 4 仓，结果按仓隔离，第一仓 fail-fast）
bash /tmp/agent-eval/run-matrix.sh    # 见同目录归档副本 run-matrix.sh
```

⚠️ **环境陷阱（首跑踩坑，已修）**：audit.sh 走 bash 调 `claude` binary（非用户的 zsh function）。**绝不要清 HTTP 代理 env**——Claude Code harness 靠 `HTTP_PROXY=127.0.0.1:55779` 这个本地代理给子进程 `claude` 注入认证 bearer token。首跑误抄了"交互式清代理走 TUN"的逻辑（`export NO_PROXY="*"`），导致 8 个 run 全部 `401 authentication_failed` 空跑（rc=0 但 0 tools/0 token/$0）。**修复 = 不动任何 proxy 变量，原样继承环境。** 证据：`raw/console-firstrun-401.log`。

## 6. 指标与判读

**自动量**（`scripts/agent-eval/parse-run.mjs` 解析 stream-json）：
- 工具调用总数 + 分布（`Read` / `Grep` / `Bash` / `omniweave_*` / `Task`）
- `omniweave tools exposed`（with arm 应 >0，without 应 0——A/B 隔离自检）
- duration、turns、tokens(in/out)、**total cost (USD)**

**人工判**（自动解析不覆盖）：
- **答案正确性**：读两个 arm 的最终回答，对照 ground truth（用 dev build 的 `callers/callees/trace` 在同一 index 上查出的真实路径）逐项核对。
- 领读信号 = **cost + tool/Read 计数**（可靠）；raw token in/out 受 subagent 委派与 prompt 缓存干扰，仅作参考（harness 作者注）。

## 7. 诚实声明（写进证据，防自我灌水）

- 含 **ky 中性对照**：若 OmniWeave 只在自己设计的场景赢、中性场景持平或更差，必须如实记。
- 含 **dplyr NSE 自曝**：主动打 OmniWeave 静态解不了的场景，验证"诚实天花板"是真帮不上、还是会误导。
- `without` arm = 真实 grep/read 基线（agent 实际消费的 stdout），非"文件总行数"灌水（§0.12 踩过的坑，此处不重犯）。
- 原始 stream-json 全量归档于 `raw/`，任何人可重解析复核。
