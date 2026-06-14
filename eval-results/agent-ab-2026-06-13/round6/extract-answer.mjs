// Extract the final agent answer (result) text from a stream-json A/B run.
// Usage: node extract-answer.mjs <jsonl>
import fs from 'fs';
const lines = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n');
let result = '';
for (const l of lines) {
  try {
    const j = JSON.parse(l);
    if (j.type === 'result' && typeof j.result === 'string') result = j.result;
  } catch { /* skip */ }
}
process.stdout.write(result);
