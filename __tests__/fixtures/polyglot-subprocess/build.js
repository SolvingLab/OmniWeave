// A JS build script that shells out to a Python script — proves general
// crossLang is not Python-specific (the same interpreter+path shape is detected
// in any function-bearing language whose strings survive comment-stripping).
const child_process = require("child_process");

function buildReport() {
  child_process.execFile("python", ["scripts/report.py", "--ci"]);
}

function buildReportSync() {
  // Recall: the synchronous `…Sync` variants (execFileSync/spawnSync) are the
  // common form in build tooling — `execFile` must resolve to execFile+Sync, not
  // get stuck on `exec` (an adversarial probe caught the `…Sync` family missed).
  child_process.execFileSync("Rscript", ["scripts/deseq.R"]);
}

module.exports = { buildReport, buildReportSync };
