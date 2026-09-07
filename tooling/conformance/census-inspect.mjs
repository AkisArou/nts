// A census of `util.inspect`, by value kind rather than by random sampling.
//
//   node tooling/conformance/census-inspect.mjs [--all]
//
// Why this exists next to `fuzz-deep-equal.mjs` rather than instead of it.
// A generator answers "do these two agree on the values I produce", and it can
// only ever be green about the region it enters: 5,000 nested structures at
// 88.5% agreement and 480,000 deep comparisons both reported health for
// `inspect` while every `Promise` printed as `{}`, because neither pool ever
// produced one. Growing such a pool samples the same distribution more times.
// So this enumerates constructors deliberately -- each kind listed once, by
// hand, in `census-inspect-cases.cjs` -- and the failure it is built to catch
// is a *kind* that has no branch at all.
//
// Error stacks are collapsed to `<stack>` before comparing. The frames differ
// between the two lanes for reasons that have nothing to do with `inspect`
// (one runs the case file through the runner, the other directly), while the
// structure around them -- an `[errors]` array, a `[cause]` -- is exactly what
// this is meant to notice.
//
// The list in `census-inspect-cases.cjs` is enumerated against a written-down
// set, which is what keeps it honest as both implementations move: every kind
// `formatByShape` in `runtime/node/util/src/inspect.ts` has a branch for, plus
// every kind node's own `inspect` special-cases and ours does not. When either
// grows a branch, add the kind here. A reader can check that the list has not
// fallen behind by reading those two branch lists against the cases; nobody
// can perform the same check on a generator, because the distribution it
// samples from is not written down anywhere.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = join(HERE, "census-inspect-cases.cjs");
const showAll = process.argv.includes("--all");

function readCensus(argv) {
  const out = execFileSync(process.execPath, argv, { encoding: "utf8", maxBuffer: 64 << 20 });
  const rows = new Map();
  for (const line of out.split("\n")) {
    if (!line.startsWith("CENSUS\t")) continue;
    const [, name, text] = line.split("\t");
    rows.set(name, text);
  }
  return rows;
}

/** Collapse consecutive stack frames, whose paths differ per lane by design. */
function normalise(text) {
  if (text === undefined) return undefined;
  return text.replace(/(\\n\s+at [^\\]*)+/g, "<stack>");
}

const ours = readCensus([join(HERE, "run-one.mjs"), "util", CASES, "-"]);
const node = readCensus([CASES]);

const differing = [];
for (const [name, expected] of node) {
  const actual = ours.get(name);
  if (normalise(actual) !== normalise(expected)) differing.push({ name, actual, expected });
}

console.log(`util.inspect census: ${node.size - differing.length} of ${node.size} kinds agree with node\n`);
for (const { name, actual, expected } of differing) {
  console.log(`  ${name}`);
  console.log(`    ours: ${showAll ? actual : String(actual).slice(0, 120)}`);
  console.log(`    node: ${showAll ? expected : String(expected).slice(0, 120)}`);
}
if (differing.length > 0) {
  console.log(`\n${differing.length} kind(s) differ. Some are deliberate: a function's name and a`);
  console.log("constructor's name are §13 language non-goals, so [Function] and { x: 1 }");
  console.log("where node prints [Function: named] and Point { x: 1 } are refusals rather");
  console.log("than defects. The conformance ledger records which is which.");
}
process.exitCode = differing.length > 0 ? 1 : 0;
