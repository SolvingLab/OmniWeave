# Round 7 方法学（可复现，零密钥）

## 被测物与唯一变量

- `NEW` = 当前 `HEAD`（输出诚实化已落地）。
- `OLD` = `fc91305`（= `ec6d0eb^`，即 SESSION-REVIEW §2 那 71 commit 的前一个 commit）。
- **schema 在两点完全相同**（`git diff fc91305 HEAD -- src/db/schema.sql` 为空，`PRAGMA user_version`=0），所以两个二进制读**同一个 `.omniweave` 索引**，把「索引差异」从变量里排除。唯一变量 = 这 71 commit 的输出层代码。

## 复现步骤

### 0. 构建 OLD 二进制（pre-hardening）
```bash
git worktree add --detach /tmp/ow-prehardening fc91305
ln -sfn "$PWD/node_modules" /tmp/ow-prehardening/node_modules   # 依赖变了但新 deps 能编旧码
( cd /tmp/ow-prehardening && npm run build )                    # → dist/bin/omniweave.js (0.1.0)
```
当前 NEW 二进制 = `command -v omniweave`（npm-link 到本仓 `dist/`，先 `npm run build`）。

### 1. Layer 1 — 确定性输出 diff（无 LLM，秒级）
`scripts/output-diff.sh`（把 `OLD` 路径改成你的 worktree dist）。两个二进制对同一索引跑同一组只读 CLI 查询，diff 输出。产物 `deterministic/*.{new,old}.txt`。
> CLI 查询只读：脚本实测 DB mtime 前后不变。

### 2. Layer 2 — agent A/B（真 LLM）
本机 **MiMo（mimo-v2.5-pro，Anthropic 协议）**驱动 headless `claude -p`。**key 不入库** —— 在 scratchpad 写 `mimo-env.sh`（值见 `~/Desktop/本机AI-API资源盘点.md`，绝不进 git）：
```bash
export ANTHROPIC_BASE_URL="https://token-plan-cn.xiaomimimo.com/anthropic"
export ANTHROPIC_AUTH_TOKEN="<MiMo key — from the resource sheet, never commit>"
export ANTHROPIC_MODEL="mimo-v2.5-pro"
export ALL_PROXY="" HTTP_PROXY="" HTTPS_PROXY="" NO_PROXY="*"   # 直连 MiMo，绕过 harness/TUN 代理
export ENABLE_TOOL_SEARCH="auto:100"   # ★ 关键：standard 模式，工具 schema 直发
export MCP_TIMEOUT="60000"             # ★ 关键：等 MCP server 连上
```
然后 `source mimo-env.sh && bash scripts/run-3arm.sh "<question>" <label> <N>`。

#### 为什么需要 `ENABLE_TOOL_SEARCH=auto:100`（踩坑实录）
MiMo 是第三方 Anthropic 兼容代理。Claude Code 的域名检查（`kx()`）发现 base_url ≠ `api.anthropic.com` → ToolSearch 门控对它**静默失灵**，MCP 工具被 defer 且 MiMo 不主动走 ToolSearch 发现它们 → **WITH arm 退化成只用 grep**（实测 `omniweave tools exposed: 0`，MiMo 直接 grep）。`auto:100` 强制 standard 模式（全量工具 schema 直发、无 defer），MCP server 连上后 omniweave 5 工具直接可见，MiMo 才会用（实测 `omniweave tools exposed: 5` + 直接调 `omniweave_callers`）。
> 形态注记：standard 模式 ≠ 默认门控形态（round6 实测门控边际 +682 tok）。本轮测**输出诚实度轴**（工具调用/read/甄别功），三 arm 同模式、唯一变量是 MCP，比较公平；但**别把这里的 input token 当默认形态成本**。

### 3. 解析
`node ../../scripts/agent-eval/parse-run.mjs <run.jsonl>` —— 工具调用序列 + by-type + turns + token + cost。**判对错是人工的**：提 `result.result` 逐条对 ground truth。

## 指标口径（沿用 round1–6）
- **主信号**：工具调用数 / turns（可靠努力信号）。
- **次信号**：input token（受缓存 + standard-mode schema 注入干扰，仅在差极大时方向可信）。
- **正确性**：人工对 ground truth；平手就记平手。

## 诚实边界
- N=2/任务、单仓（OmniWeave 自身）、MiMo 单模型 → 趋势信号，非统计显著。
- 靶仓内嵌竞品快照（`research/**/repos/`，gitignored）放大了「快照泄漏」触发面，普通用户仓收益更小。
- 见 `RESULTS.md` 末「诚实边界与结论」。
