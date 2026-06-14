// Detailed token breakdown per run: the FIRST assistant turn's usage (isolates
// the system-prompt / tool-schema fixed overhead) + the result-line totals.
// Usage: node token-breakdown.mjs <jsonl> [<jsonl> ...]
import fs from 'fs';
for (const f of process.argv.slice(2)) {
  if (!fs.existsSync(f)) { console.log(`${f}: MISSING`); continue; }
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  let firstUsage = null, resultUsage = null;
  for (const l of lines) {
    try {
      const j = JSON.parse(l);
      if (!firstUsage && j.type === 'assistant' && j.message?.usage) firstUsage = j.message.usage;
      if (j.type === 'result' && j.usage) resultUsage = j.usage;
    } catch { /* skip */ }
  }
  const fmt = (u) => u ? `in=${u.input_tokens} cr=${u.cache_read_input_tokens||0} cc=${u.cache_creation_input_tokens||0}` : 'n/a';
  const name = f.split('/').slice(-1)[0];
  // First-turn input+cache_creation ≈ the system prompt + tools + question (the fixed attach cost).
  const firstFixed = firstUsage ? (firstUsage.input_tokens||0) + (firstUsage.cache_creation_input_tokens||0) + (firstUsage.cache_read_input_tokens||0) : '?';
  console.log(`${name}: FIRST-turn[${fmt(firstUsage)}] firstTotal=${firstFixed} | RESULT[${fmt(resultUsage)}]`);
}
