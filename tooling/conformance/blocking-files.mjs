// Which files' refusals sit on the most modules' paths.
//
//   node tooling/conformance/blocking-files.mjs <dir-of-build-logs>
//   node tooling/conformance/blocking-files.mjs /tmp/.../scratch --prefix ib-
//
// A per-module root count says how far one module is from compiling. It does
// not say what to fix first, because the same construct in a shared file is
// counted once per module that imports it and nowhere as one thing.
//
// Ranked across a 22-module build, by how many modules each file blocks:
//
//     runtime/node/internal/errors.ts        21 modules   17 sites
//     runtime/node/internal/validators.ts    21 modules    4 sites
//     runtime/node/internal/uv.ts            16 modules    4 sites
//     runtime/node/internal/async-hooks.ts   15 modules    7 sites
//     runtime/node/buffer/src/main.ts        13 modules   23 sites
//
// **Four sites in `internal/validators.ts` are on the path of 21 of 22
// modules**, and two of the four are one cause:
//
//     15:26   const LINK_HEADER_VALUE = /^(?:<[^>\r\n]*>)…/   a regex literal
//     166:37  LINK_HEADER_VALUE.test(value)                   downstream of 15
//     232:14  const OCTAL = /^[0-7]+$/                        a regex literal
//     243:16  const given = value ?? byDefault                an erased value
//
// # Sites, not occurrences
//
// Both numbers are here because they answer different questions and the wrong
// one is much larger. `errors.ts` produces 357 NTS1001 *lines* across the 22
// builds and has **17** distinct `line:col`. Quoting 357 would describe the
// number of times 21 modules each recompiled the same seventeen constructs.
//
// # The parse, which was wrong in a way that only under-reported
//
// The first version matched `NTS1001 (.*?) is not supported`, and **295 lines
// do not end that way** -- the `a declaration outside every walk` family reads
// `NTS1001 `atob`, a declaration outside every walk` with no suffix. They were
// dropped silently, and `internal/uv.ts` came out as 2 distinct sites when it
// has 4.
//
// It is reported here rather than just fixed because of the direction: a parse
// that drops what it cannot match makes a blocking file look *less* blocking,
// and there is nothing in the output to say so. The count of unparsed lines is
// printed on every run for that reason -- a run that cannot parse its input
// should say how much of it.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith("--"));
const prefixFlag = argv.indexOf("--prefix");
const prefix = prefixFlag === -1 ? "ib-" : argv[prefixFlag + 1];
const ROOT = resolve(new URL("../..", import.meta.url).pathname) + "/";

if (dir === undefined || !existsSync(dir)) {
  console.error("usage: blocking-files.mjs <dir-of-build-logs> [--prefix ib-]");
  console.error("  logs are <prefix><module>.log, as written by a build sweep");
  process.exit(2);
}

const logs = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".log"));
if (logs.length === 0) {
  console.error(`INSTRUMENT FAILURE: no ${prefix}*.log in ${dir}.`);
  console.error("An empty ranking is not a clean tree.");
  process.exit(2);
}

const sites = new Map();      // file -> Set("line:col")
const modules = new Map();    // file -> Set(module)
const occurrences = new Map();
let unparsed = 0;
let total = 0;

for (const log of logs.sort()) {
  const module = log.slice(prefix.length, -4);
  for (const line of readFileSync(join(dir, log), "utf8").split("\n")) {
    if (!line.includes("NTS1001")) continue;
    total += 1;
    // No trailing anchor. The message shape varies and requiring one dropped
    // 295 lines in the direction that hides a blocker.
    const m = /^(.*?):(\d+):(\d+): NTS1001 /.exec(line.trim());
    if (m === null) { unparsed += 1; continue; }
    const file = m[1].replace(ROOT, "");
    if (!sites.has(file)) { sites.set(file, new Set()); modules.set(file, new Set()); }
    sites.get(file).add(`${m[2]}:${m[3]}`);
    modules.get(file).add(module);
    occurrences.set(file, (occurrences.get(file) ?? 0) + 1);
  }
}

console.log(`  ${logs.length} build log(s), ${total} NTS1001 line(s), ${unparsed} unparsed`);
if (unparsed > 0) {
  console.log("  An unparsed line is a refusal attributed to no file, which makes");
  console.log("  every ranking below an understatement. Fix the pattern first.");
}
console.log();
console.log(`  ${"file".padEnd(42)} ${"modules".padStart(7)} ${"sites".padStart(6)} ${"lines".padStart(6)}`);
const ranked = [...sites.keys()].sort((a, b) =>
  modules.get(b).size - modules.get(a).size || sites.get(b).size - sites.get(a).size);
for (const f of ranked.slice(0, 15)) {
  console.log(`  ${f.padEnd(42)} ${String(modules.get(f).size).padStart(7)} ` +
    `${String(sites.get(f).size).padStart(6)} ${String(occurrences.get(f)).padStart(6)}`);
}
console.log();
console.log("  `sites` is distinct line:col; `lines` counts every module that");
console.log("  recompiled them. A file high on modules and low on sites is where");
console.log("  the fewest fixes reach the most modules.");
