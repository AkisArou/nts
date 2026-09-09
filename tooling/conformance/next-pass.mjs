// What stands in front of the next compiled pass, module by module.
//
//   NTS_ADDON_OUT=<a private directory> node tooling/conformance/next-pass.mjs
//   NTS_ADDON_OUT=<...> node tooling/conformance/next-pass.mjs querystring stream
//
// # The question the axis does not answer
//
// The axis says a module has one pass. It does not say what the second one is
// waiting for, and the answer is not the same everywhere: `querystring` has
// **six of its seven failures stopping at one absent export**, where another
// module's failures may be six different things.
//
// That distinction decides where an afternoon goes. `querystring.parse` is
// behind `decodeURIComponent`, an unimplemented builtin -- a write-it-out job
// with six files behind it, on a module already on the axis. A representation
// with twenty-four things behind it spread over seven modules is worth more in
// total and cannot be finished in an afternoon.
//
// So this groups each module's failures by their reason and prints the largest
// group. A module whose failures share a reason has a queue behind one fix; a
// module whose failures are all different does not.
//
// # What a count here is and is not
//
// **It is what stands in front of those files, not what they would gain.** A
// test failing at `qs.parse is not a function` fails there because that is the
// first question it asks. Clearing it reveals the second, which may be another
// absent export in the same file. `cascade-reach.mjs` says the same thing about
// cones: it sizes a queue rather than a step.
//
// Reasons are normalised lightly -- a quoted name and a number are held, since
// `parse is not a function` and `stringify is not a function` are different
// facts about the same module. Two failures grouped that should not have been
// would overstate the largest group, which is the direction that misleads, so
// the grouping is deliberately shallow and the raw lines are printed under it.

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const ADDON_DIR = process.env.NTS_ADDON_OUT ?? join(ROOT, "target/node");

const argv = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const modules = argv.length > 0
  ? argv
  : readdirSync(join(ROOT, "runtime/node"))
    .filter((m) => m !== "node_modules" && existsSync(join(ROOT, "runtime/node", m, "tsconfig.json")))
    .sort();

/* Words that carry no information about which name a failure is about. */
const COMMON = new Set([
  "not", "function", "missing", "the", "and", "was", "expected", "received",
  "must", "type", "argument", "arguments", "undefined", "instance", "object",
  "string", "number", "error", "Error", "TypeError", "assert", "value", "with",
  "for", "from", "have", "has", "but", "got", "should", "does", "this", "that",
  "call", "called", "times", "test", "node", "compiled", "requires",
]);

let examined = 0;
const findings = [];

for (const module of modules) {
  const addon = join(ADDON_DIR, `${module}.node`);
  if (!existsSync(addon)) continue;
  const run = spawnSync(
    process.execPath,
    ["tooling/conformance/run.mjs", "--module", module, "--addon", addon],
    { cwd: ROOT, encoding: "utf8", timeout: 1_800_000 },
  );
  const out = `${run.stdout ?? ""}`;
  examined += 1;

  // A FAIL line is followed by its reason, indented further.
  const lines = out.split("\n");
  const reasons = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s{2}FAIL\s{2}/.test(lines[i])) continue;
    const reason = (lines[i + 1] ?? "").trim();
    reasons.push(reason === "" ? "(no reason printed)" : reason);
  }
  const summary = lines.filter((l) => l.includes("file(s):")).pop() ?? "";
  if (reasons.length === 0) {
    findings.push({ module, summary, groups: [], total: 0 });
    continue;
  }

  const groups = new Map();
  for (const reason of reasons) {
    const key = reason.slice(0, 70);
    if (!groups.has(key)) groups.set(key, 0);
    groups.set(key, groups.get(key) + 1);
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1] - a[1]);

  // A second, looser count, because the strict one understates badly and the
  // understatement hides the finding. In `querystring`, `qs.parse is not a
  // function`, `parse is not a function` and `parse is missing` are three
  // groups and one fact; by hand, six of seven failures name `parse`.
  //
  // So: the identifier mentioned in the most failure lines, counted separately
  // and labelled separately. It is looser and can group two different problems
  // that happen to name the same thing, which is why it does not replace the
  // strict count -- both are printed, and where they disagree the disagreement
  // is the information.
  const mentions = new Map();
  for (const reason of reasons) {
    for (const word of new Set(reason.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? [])) {
      if (COMMON.has(word)) continue;
      mentions.set(word, (mentions.get(word) ?? 0) + 1);
    }
  }
  const named = [...mentions.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  findings.push({ module, summary, groups: ranked, total: reasons.length, named });
}

// Ordered by how much of a module's failure sits behind one reason, because
// that is the quantity this exists to surface.
findings.sort((a, b) => (b.groups[0]?.[1] ?? 0) - (a.groups[0]?.[1] ?? 0));

for (const f of findings) {
  if (f.total === 0) {
    console.log(`  ${f.module}: no failing file`);
    continue;
  }
  const [topReason, topCount] = f.groups[0];
  const share = `${topCount} of ${f.total}`;
  console.log(`  ${f.module}: ${f.total} failing, largest group ${share}`);
  console.log(`      ${topReason}`);
  if (f.named !== null && f.named[1] > topCount) {
    console.log(`      and ${f.named[1]} of ${f.total} name \`${f.named[0]}\` somewhere in the line,`);
    console.log("      which is the looser grouping and can join two problems over one name");
  }
  for (const [reason, count] of f.groups.slice(1, 3)) {
    console.log(`      ${String(count).padStart(3)}  ${reason}`);
  }
}

if (examined === 0) {
  console.log("  INSTRUMENT FAILURE: no addon was found to run against.");
  console.log("  An empty run is not a clean run. Check NTS_ADDON_OUT.");
  process.exit(2);
}
console.log(`\n  ${examined} module(s) examined. A count is what stands in front of those`);
console.log("  files, not what they would gain: clearing the first question a test asks");
console.log("  reveals the second. It sizes a queue, the way a cone does.");
