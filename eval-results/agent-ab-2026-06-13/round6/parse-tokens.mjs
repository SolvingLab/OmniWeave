// Per-run effort signals from a stream-json A/B run: tool calls, turns, cost,
// and total input tokens (cache_read + cache_creation + input on the result line).
// Usage: node parse-tokens.mjs <label> <jsonl> [<jsonl> ...]
import fs from 'fs';
for (const f of process.argv.slice(2)) {
  if (!fs.existsSync(f)) { console.log(`${f}: MISSING`); continue; }
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  let tools = 0, byType = {}, omni = 0, result = null;
  for (const l of lines) {
    try {
      const j = JSON.parse(l);
      const m = j.message;
      if (m && Array.isArray(m.content)) for (const c of m.content) {
        if (c.type === 'tool_use') { tools++; byType[c.name] = (byType[c.name] || 0) + 1; if (/omniweave/.test(c.name)) omni++; }
      }
      if (j.type === 'result') result = j;
    } catch { /* skip */ }
  }
  const u = result?.usage || {};
  const inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  const name = f.split('/').slice(-2).join('/');
  console.log(`${name}: tools=${tools} omni=${omni} turns=${result?.num_turns ?? '?'} cost=$${(result?.total_cost_usd ?? 0).toFixed(3)} inTok=${inTok} out=${u.output_tokens ?? '?'}`);
}
