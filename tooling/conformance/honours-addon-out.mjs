// Which instruments name the shared artifact directory literally.
//
//   node tooling/conformance/honours-addon-out.mjs
//
// `target/node` is shared with the other sessions in this checkout. A script
// that forms a path from it measures whatever they last built, and -- this is
// the part that cost a day -- it does so **while appearing to measure a private
// directory**, because the caller sets `NTS_ADDON_OUT` in the environment and
// nothing says it was ignored.
//
// That happened. `unusable-exports.mjs` reported ten published functions whose
// `length` disagrees with their own arity check -- `os.getPriority` length 0
// demanding 1, all of punycode, `url.isURL` -- and it was written up as a
// direct consequence of the wrapper's new length rule, three sentences from
// being sent to the compiler lane as evidence their fix was wrong. Rebuilding
// one module into a private directory made every row vanish. Three other
// instruments had the same defect, and `sweep.mjs` was additionally *writing*
// `$module.gap` into the shared directory.
//
// The general form is worth more than the four fixes: **an output-directory
// variable is a claim about a script until that script is the one you checked.**
// A run that sets the variable and a run that does not are indistinguishable
// from the outside, so nothing in a result says which happened. Hence a check.
//
// # What it decides
//
// A line naming `target/node` is a finding unless it also names
// `NTS_ADDON_OUT` -- that is the default-expression form,
// `process.env.NTS_ADDON_OUT ?? join(ROOT, "target/node")`, which is correct
// and is what the fixed files look like. Comments and usage lines are skipped:
// this directory documents its own hazards at length, and a file explaining why
// `target/node` is shared would otherwise be reported for saying so.
//
// It cannot see every way of forming the path -- a variable assembled from
// pieces, or a default that arrives through an argument -- so silence here is
// not a clearance, in the same sense as everything else in this directory.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// A directory argument, so the check itself can be controlled.
//
// Pointed at this directory it reports nothing, and a check that has never been
// seen to fire is a claim about the files rather than a measurement of them.
// Pointed at the four fixed files as they were before the fix, it reports all
// four -- which is what makes the clean run above mean something.
const TARGET = process.argv[2] ?? HERE;

/** A comment, or a usage example inside one. */
function isProse(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("#") || t.startsWith("*") ||
    t.startsWith("/*") || t.startsWith(">");
}

const files = readdirSync(TARGET)
  .filter((f) => f.endsWith(".mjs") || f.endsWith(".sh"))
  .filter((f) => f !== "honours-addon-out.mjs")
  .sort();

let checked = 0;
const findings = [];
for (const file of files) {
  const source = readFileSync(join(TARGET, file), "utf8");
  if (!source.includes("target/node")) continue;
  checked++;
  const bad = [];
  source.split("\n").forEach((line, i) => {
    if (!line.includes("target/node")) return;
    if (isProse(line)) return;
    // `target/node-test-tmp` is a different directory with a shared prefix.
    if (/target\/node[-A-Za-z]/.test(line)) return;
    if (line.includes("NTS_ADDON_OUT")) return;
    bad.push([i + 1, line.trim()]);
  });
  if (bad.length > 0) findings.push([file, bad]);
}

for (const [file, bad] of findings) {
  console.log(`  HARDCODED  ${file}`);
  for (const [line, text] of bad) console.log(`             :${line}  ${text.slice(0, 76)}`);
}

if (checked === 0) {
  console.log("  INSTRUMENT FAILURE: no file in this directory mentions target/node.");
  console.log("  An empty run is not a clean run -- check the glob before believing it.");
  process.exit(2);
}
console.log(
  `\n  ${checked} file(s) name the artifact directory, ${findings.length} form a path from it ` +
  "without\n  honouring NTS_ADDON_OUT. Those measure whatever another session last built.",
);
if (findings.length === 0) {
  console.log("  Every one of them takes the variable.");
}
