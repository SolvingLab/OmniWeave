# Getting agents to actually use OmniWeave (not Read) — design notes & handoff

> Working doc for a fresh session. Two problems to crack:
> **(P1)** agents still reach for `Read`/`grep` during implementation instead of OmniWeave;
> **(P2)** on startup the OmniWeave MCP server can be `pending` when the agent's first turn fires, so the agent runs with *no* OmniWeave at all.
>
> Read `omniweave/CLAUDE.md` → "Retrieval performance & dynamic-dispatch coverage" first — it's the doctrine these ideas must respect.

---

## Context — what already shipped (so you don't repeat it)

- **#733 (`7175dc4`)** — reframed the agent-facing steering (`src/mcp/server-instructions.ts` + the `omniweave_node`/`omniweave_explore` descriptions in `src/mcp/tools.ts`) to cover *implementation*, not just Q&A; and added **file-view mode**: `omniweave_node` now accepts a bare `file` (no `symbol`) → returns that file's symbol map + its dependents (blast radius) + verbatim bodies (`includeCode`). `handleFileView` in `src/mcp/tools.ts`.
- **Clean A/B result** (new build vs baseline build, both omniweave-connected, same fully-implemented task — `kindExclude` added to `omniweave_search`):
  - **baseline:** 0 OmniWeave calls, 8 Reads (agent *ignored* available OmniWeave).
  - **new:** 2 `omniweave_explore` calls, 5 Reads.
  - So the reframe *did* move tool-choice — but the agent used `omniweave_explore`, **never the file-view**, and still Read 5×. n=1/arm.
- **Eval harness fix** (`#735`): nested attach is a *startup-latency* problem, not a hard block. `scripts/agent-eval/ab-new-vs-baseline.sh` now pre-warms a daemon + skips the re-exec; use it (run non-nested for cleanest results).

**Doctrine constraints (from CLAUDE.md — do not relitigate):**
- *Adapt the tool to the agent.* Changing tool descriptions / `server-instructions.ts` is **low-salience** and has *regressed* wall-clock before. Wording alone won't reliably move tool-choice.
- *New tools fare worse than extending an existing one* (the agent under-picks even `trace`; `omniweave_context` was removed).
- The real levers that landed historically: **coverage** (more flows connect statically → `explore` surfaces them) and **sufficiency** (output complete enough that the agent *stops* reading).
- The optimization target is **wall-clock + tool-call count + Read=0**, not token cost (cost is lower as a side effect).

---

## P1 — Agents under-use OmniWeave during implementation

### STATUS — 2026-06-08 (RESOLVED via Read-parity, not a hook)

**The fix: make `omniweave_node` read a file *exactly like the Read tool*, only
faster — so the agent reaches for it naturally. No forcing.** The owner's steer
settled the direction: *"OmniWeave should be able to Read just like the Read
tool… make it as good as Read. Read is slow and old; querying the index is fast.
You keep diverging away from using OmniWeave rather than pursuing the fix."*

**DONE — `handleFileView` (`src/mcp/tools.ts`) is now full Read parity:**
- A `file` with no `symbol` returns the file's current source numbered
  **byte-for-byte the way Read does — `<n>\t<line>`, no padding, trailing empty
  line kept** (verified by reading the same file with both and diffing). The only
  addition is a **one-line blast-radius header** (`used by N files: …`).
- **`offset` / `limit` mean exactly what they do on Read** (1-based start; max
  lines; default whole file capped at 2000 lines like Read). Large files paginate
  honestly (`(lines X–Y of N — pass offset/limit…)`), never the 15k `truncateOutput` chop.
- Content is the **default** (no `includeCode` needed); `symbolsOnly: true` returns
  the cheap structural map instead. Security preserved: `yaml`/`properties`
  summarized by key, never dumped (#383); reads via `validatePathWithinRoot` (#527).
- Tests: `__tests__/node-file-view.test.ts` (9, incl. strict format parity
  `^1000\t  const v998 = 998;` and unpadded `^1\timport …`). Full suite green
  (1270). Descriptions / `server-instructions.ts` / CHANGELOG reframed: "read a
  source file with omniweave_node instead of Read — same bytes, faster."

**The hook (idea 1) — A/B'd and REJECTED. Do not ship.** Kept only as an eval
artifact (`scripts/agent-eval/redirect-read-hook.sh` + `ab-hook.sh`).
- Clean A/B (2 runs/arm, devpit "add `dp ping`, build it"; both arms omniweave-attached):
  - **nohook:** 0 OmniWeave calls, 1 Read, **5–7 tool calls, 6–8 turns, 55–77s.** (Reproduces P1: agent ignores OmniWeave — but read-once-and-edit is *efficient* here.)
  - **hook (deny-redirect):** 0 *successful* Reads + 1 file-view call (parity worked, edit compiled), but **8–9 tool calls, 9–10 turns, 200–239s**, and the agent **fought the deny** — `ToolSearch` to find the tool, reflexive re-Read (denied), then **`Bash python3` to read the file around the block.**
  - Verdict: a blanket Read-deny **regresses the target metrics (~2× tool calls, more turns) on a simple edit** and the agent routes around it. Forcing is the wrong lever; making the tool genuinely better than Read is the right one.
- If routing is ever revisited: not a blanket hook. Either a narrow trigger (large
  files only / after-N-reads) **with a clean A/B on a Read-heavy multi-file task**
  (the hook's best case, untested), or just keep widening coverage + sufficiency.

---

**Current truth:** the broad Read/Grep redirect hook was A/B'd and rejected above.
Do not re-open it as a default or installer recommendation. The remaining levers
are narrower and must be validated on Read-heavy implementation tasks:

1. **Sufficiency first.** Make existing `explore` / `node` output complete enough
   that a normal implementation step does not need a follow-up Read. The file-view
   is useful only if it naturally gives the agent the exact edit context it needs.
2. **Coverage second.** Every newly connected static flow is one less flow an
   agent has to reconstruct with grep/read. This is the durable lever.
3. **Only revisit hooks as a narrow experiment.** A hook may be worth testing for
   large indexed files or after repeated Reads, but a blanket redirect has already
   regressed tool count, turns, and wall-clock.

---

## P2 — Agent runs without OmniWeave because the server is `pending` at startup

**Symptom:** `serve --mcp` isn't ready when the agent's first turn fires (the host marks the MCP server `status:"pending"` / 0 tools), so the agent starts Read/grep and never uses OmniWeave. We saw this hard in nested evals (~2-3s startup vs the agent's turn-1); **real users hit a milder version** — the first query of a session may not have OmniWeave.

### Root cause
`serve --mcp` does a `--liftoff-only` **re-exec** (for a node memory flag) **and** spawns/binds a detached **daemon** before tools are usable. Under load that exceeds the host's MCP-startup window. (`OMNIWEAVE_WASM_RELAUNCHED=1` skips the re-exec; pre-warming a daemon removes the bind latency — both proven in `ab-new-vs-baseline.sh`. But a real user can't pre-warm.)

### Ideas, ranked

1. **OMNIWEAVE-SIDE — expose the static tool list INSTANTLY, decoupled from the daemon. *Biggest shippable win; helps every user.***
   - Hypothesis: the host marks OmniWeave `pending` because `tools/list` (tool exposure) waits on the daemon connect. The local handshake already answers `initialize` fast (~107ms; `runLocalHandshakeProxy` in `src/mcp/proxy.ts`, `getStaticTools` is imported there). **Investigate: does `serve --mcp` answer `tools/list` *locally and instantly* from `getStaticTools`, or does it forward it to the still-connecting daemon?** If the latter, decouple it: advertise the static tools the moment the client asks, mark connected, and resolve the daemon in the background for actual tool *calls*.
   - Verify with: `printf '<initialize>\n<initialized>\n<tools/list>\n' | node dist/bin/omniweave.js serve --mcp --path <repo>` and time the `tools/list` response, daemon-mode vs in-process. In-process answered in ~165ms; daemon-mode is the suspect.
   - If this lands, `pending`-at-startup largely disappears without any host change.

2. **OMNIWEAVE-SIDE — speed/skip the re-exec on the MCP serve path.** The re-exec exists for a V8 memory flag (`src/extraction/wasm-runtime-flags.ts`, `RELAUNCH_GUARD_ENV = OMNIWEAVE_WASM_RELAUNCHED`). For MCP serving on a normal repo the flag may be unnecessary, or settable without a full process re-exec. Removing one process spawn from the cold path shaves the startup window.

3. **OMNIWEAVE-SIDE — a SessionStart hook that pre-warms the daemon.** Ship an opt-in Claude Code `SessionStart` hook (installer-added) that spawns/warms the daemon for the project at session start, so it's bound before the first query. Mitigation if (1) is hard.

4. **HOST-SIDE — "wait/retry on pending" — this is what you asked about, but it's a Claude Code (MCP client) behavior, not OmniWeave's to fix.** OmniWeave can't make the agent retry. Options: (a) raise it with Anthropic as an MCP-client improvement (don't let the agent's first turn proceed until configured MCP servers finish connecting, or retry `pending` servers); (b) note `MCP_TIMEOUT` exists but did **not** help here, because the problem is *tool exposure timing*, not a connection timeout. Frame this as a request, and lean on (1)–(3) for what we control.

**Recommendation:** chase **idea 1** (decouple `tools/list` from the daemon). It's the fix that makes OmniWeave "connected" instantly for everyone. Ship **idea 3** (pre-warm SessionStart hook) as a cheap mitigation in parallel. File the host-side request (4) but don't depend on it.

---

## Key files / pointers

- **Steering / tools:** `src/mcp/server-instructions.ts` (the `initialize` instructions — single source of truth), `src/mcp/tools.ts` (tool descriptions + handlers; `handleNode`/`handleFileView`/`handleSearch`, `getStaticTools`).
- **Startup / daemon / proxy:** `src/mcp/proxy.ts` (`runProxy`, `connectWithHello`, `runLocalHandshakeProxy`, PPID watchdog), `src/mcp/index.ts` (`runProxyWithLocalHandshake`, `spawnDetachedDaemon`), `src/mcp/daemon.ts`.
- **Runtime flags:** `src/extraction/wasm-runtime-flags.ts` (`RELAUNCH_GUARD_ENV=OMNIWEAVE_WASM_RELAUNCHED`, `HOST_PPID_ENV=OMNIWEAVE_HOST_PPID`).
- **Hooks (existing):** `scripts/agent-eval/block-read-hook.sh`, `scripts/agent-eval/hook-settings.json` (the eval's force-Read-0 hook — basis for the P1 redirect hook).
- **Installer (where to add a recommended hook):** `src/installer/targets/claude.ts`.
- **Eval harness:** `scripts/agent-eval/ab-new-vs-baseline.sh` (new-vs-baseline, pre-warm baked in), `run-all.sh` (with-vs-without), `parse-run.mjs` (tool-by-type counts; `omniweave tools exposed: 0` + 0 OmniWeave calls = ran without).
- **Doctrine:** `CLAUDE.md` → "Retrieval performance & dynamic-dispatch coverage" + the agent-eval note under "Validation methodology".

## How to validate anything here
- **P1 (Read displacement):** `bash scripts/agent-eval/ab-new-vs-baseline.sh <indexed-repo> "<implementation task>" [baseline-ref]` — compare `Read` vs `mcp__omniweave__*` counts. ≥2 runs/arm (n=1 is noisy). Run non-nested for cleanest results. Use a *genuinely new* feature task (verify it doesn't already exist — the first A/B attempt wasted a run on an already-implemented `--quiet`).
- **P2 (startup):** time `tools/list` from `serve --mcp` (above); and count cold-start runs where `init` shows `connected` + tools > 0. Don't trust a single `pending` init snapshot — confirm by whether the agent actually called OmniWeave.

## Constraints / gotchas to remember
- Descriptions/instructions are low-salience — **A/B every behavioral claim**, don't ship wording on faith.
- New tools < extending existing ones.
- The host's `init` snapshot can say `pending` even when the server then connects — judge by actual usage.
- Don't run evals nested for "clean" numbers unless pre-warmed; even then, a real terminal is better.

## Suggested start order for the fresh session
1. **P2 idea 1** — verify whether `serve --mcp` answers `tools/list` locally/instantly; if not, decouple it from the daemon. (Highest-value, shippable, helps all users, no behavioral guesswork.)
2. **P1 sufficiency** — pick a Read-heavy implementation task and check whether
   `explore` / `node` already returns enough context to edit without a fallback
   Read; improve output only where the A/B shows a real gap.
3. Ship the P2 SessionStart pre-warm hook as a mitigation; file the host-side wait/retry request.
