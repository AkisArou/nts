// What refuses in `runtime/node`, ranked by **cause** rather than by occurrence.
//
//   node tooling/census/node-refusals.ts [--sites N] [--module M]
//   node tooling/census/node-refusals.ts --from <dir> [--sites N]
//
// `--from <dir>` counts a *previous* emission's diagnostics instead of running
// one: `<dir>/<module>.sites`, one `path:line:col: NTS1001 message` per line.
// `tooling/gate/all.sh`'s `profile` step writes exactly those files and then
// reads this, so **the gate's ceiling and this ranking are one count** rather
// than two derivations of it -- the defect that has cost this repository more
// than any other. It also means the gate pays for one emission rather than two,
// and `profile` is already its slowest step.
//
// The numbers a `--from` run reports are the producer's: `profile` emits with
// `--napi`, and the check in the note below (the distinct-site count is 1738
// either way) is what says that does not change them.
//
// # Why this exists
//
// `tooling/gate/all.sh`'s `profile` step counts refusals across the 26
// `runtime/node` modules and prints one number -- 17,106 on 2026-09-21 -- with
// a ceiling to lower toward. Its own comment explains the bargain: "a feature
// that lands is supposed to move this number down". That is the right idea and
// the number is the wrong unit.
//
// It counts **occurrences**. Three source lines in
// `runtime/web-platform/src/streams/fifo.ts` -- a generic `Fifo<T>` whose
// `value` parameter is `closeSentinel | W | undefined` -- account for 882 of
// them, because each line is reported 21 times per module (once per generic
// instantiation) across 14 modules that import the file. That is a 294x
// multiplier on one construct, and it was the single largest item in the
// census.
//
// Deduplicated by `file:line:column` and message, the same run is **1,777
// sites**, and the closeSentinel union is **3**. The ranking is not similar:
//
//     by occurrence                        by unique site
//     882  closeSentinel | W | undefined     3  closeSentinel | W | undefined
//     812  an array of WeakRef              49  an array of WeakRef
//
// A number that rewards clearing whichever construct happens to sit in a
// widely-imported dependency, 21 times per instantiation, is not a work
// signal. Both are reported here, side by side, so neither can be mistaken for
// the other.
//
// # What it does not do
//
// **Three counts are defensible here and they are not interchangeable.** On
// the 2026-09-21 run:
//
//     1738   distinct sites                 `file:line:column`
//     1741   (site, generalised cause)      what this file sums
//     1777   (site, verbatim message)       distinct complaints
//
// 1738 -> 1741 is exactly **three** sites that carry two different causes each
// --- `stream/src/add-abort-signal.ts:39:32`, `buffer/src/main.ts:623:54`,
// `stream/src/iter/utils.ts:235:2` --- and 1741 -> 1777 is one cause reported
// in several spellings at one place.
//
// This file ranks *causes*, so it sums the second and says so: a site blocked
// two ways is two pieces of work. The gate prints the first, because a single
// headline number should be a count of places. `--napi` makes no difference to
// any of them, which was checked rather than assumed --- with and without it
// the distinct-site count is 1738.
//
// Quote whichever you mean, with its key, and never one number under the
// other's name.
//
// **The gate ceilings the second, (site, cause).** It held occurrences until
// 2026-09-30, and the argument for changing it is in `profile`'s own comment:
// `assert` went 799 -> 839 occurrences while its distinct sites went 492 -> 489,
// so the ceiling's number rose while the thing it exists to watch fell. A unit
// that can move in the opposite direction to its subject is not a bound.
//
// (site, cause) rather than the bare position, because a position deduplicates
// two *different* refusals that land on one line and column -- three such sites
// on the run above -- and a ceiling must not be blind to a new cause appearing
// at an old place. It is the narrower unit of the two that do not inflate.
//
// It does not follow cascades. `NTS1003` is a refusal *caused by* another
// refusal, and this counts `NTS1001` roots only -- see
// `tooling/conformance/blockers-check.mjs` for why a root and its cascade are
// different questions. A root cleared here may reveal another behind it, which
// is the compiler reporting one blocker at a time and not a defect in this.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const NTS = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");

const args = process.argv.slice(2);
const limit = Number(args[args.indexOf("--sites") + 1]) || 20;
const only = args.includes("--module") ? args[args.indexOf("--module") + 1] : null;
const from = args.includes("--from") ? args[args.indexOf("--from") + 1] : null;

/** The modules to account for, and where each one's diagnostics come from. */
const modules = from
  ? readdirSync(from)
      .filter((f) => f.endsWith(".sites"))
      .map((f) => f.slice(0, -".sites".length))
      .filter((m) => !only || m === only)
      .sort()
  : readdirSync(join(ROOT, "runtime/node"))
      .filter((m) => existsSync(join(ROOT, "runtime/node", m, "tsconfig.json")))
      .filter((m) => !only || m === only);

if (modules.length === 0) {
  // A discovery loop that finds nothing must say so rather than report zero --
  // the same failure `profile()` guards against in the gate, and the reason this
  // is checked for `--from` too: an empty directory is not a clean corpus, it is
  // a producer that wrote nothing, and under a ceiling it would read as zero
  // refusals and pass.
  console.error(
    from
      ? `no <module>.sites files under ${from}; this measured nothing`
      : "no runtime/node modules found; this measured nothing",
  );
  process.exit(1);
}

/** Strip the parts that make two reports of one cause look like two causes. */
function generalise(message) {
  return message
    .replace(/ is not supported by this lowering yet$/, "")
    .replace(/`[^`]*`/g, "`X`")
    .replace(/\([^)]*\)/g, "(...)");
}

const occurrences = new Map();
const sites = new Map();
const perModule = new Map();

const perModuleSites = new Map();

for (const m of modules) {
  let lines;
  if (from) {
    lines = readFileSync(join(from, `${m}.sites`), "utf8").split("\n").filter((l) => l.includes("NTS1001"));
  } else {
    const run = spawnSync(
      NTS,
      ["emit-c", join(ROOT, "runtime/node", m, "tsconfig.json"), "--out", join(ROOT, "target/census-refusals", m)],
      { encoding: "utf8", env: { ...process.env } },
    );
    lines = `${run.stderr ?? ""}`.split("\n").filter((l) => l.includes("NTS1001"));
  }
  perModule.set(m, lines.length);
  perModuleSites.set(m, new Set());
  for (const line of lines) {
    const at = /^(.*?):(\d+):(\d+): NTS1001 (.*)$/.exec(line);
    if (!at) continue;
    const [, file, row, col, message] = at;
    const cause = generalise(message);
    occurrences.set(cause, (occurrences.get(cause) ?? 0) + 1);
    if (!sites.has(cause)) sites.set(cause, new Set());
    sites.get(cause).add(`${file}:${row}:${col}`);
    perModuleSites.get(m).add(`${file}:${row}:${col}\u0000${cause}`);
  }
}

const totalOccurrences = [...occurrences.values()].reduce((a, b) => a + b, 0);
const totalSites = [...sites.values()].reduce((a, s) => a + s.size, 0);
const distinctSites = new Set([...sites.values()].flatMap((s) => [...s])).size;

// `totalSites` sums sites per cause, so it is (site, cause) pairs and is named
// that. `distinctSites` is the count of places, which is what the gate prints.
console.log(
  `${modules.length} module(s): ${totalOccurrences} refusal occurrence(s) at ` +
    `${distinctSites} site(s), ${totalSites} (site, cause) pair(s) -- ` +
    `${(totalOccurrences / Math.max(distinctSites, 1)).toFixed(1)}x`,
);
// **One line the gate parses, and a stable key for each number.** A step that
// greps a prose sentence breaks the day the sentence is reworded, and a number
// read under the wrong key is the mistake this whole file exists about.
console.log(
  `gate: modules=${modules.length} occurrences=${totalOccurrences} ` +
    `places=${distinctSites} pairs=${totalSites}`,
);
// Per module, so a ceiling that trips can name where -- the remedy `profile`'s
// comment prescribes five separate times ("per module, so a module that joined
// the glob shows itself") without the step ever being able to do it.
console.log();
console.log("  pairs  occurs  module");
for (const m of modules) {
  console.log(
    `  ${String(perModuleSites.get(m).size).padStart(5)}  ${String(perModule.get(m)).padStart(6)}  ${m}`,
  );
}
console.log();
console.log("  sites  occurs  cause");
const ranked = [...sites].sort((a, b) => b[1].size - a[1].size).slice(0, limit);
for (const [cause, set] of ranked) {
  console.log(
    `  ${String(set.size).padStart(5)}  ${String(occurrences.get(cause)).padStart(6)}  ${cause.slice(0, 96)}`,
  );
}

// **The rows where the two disagree most** are the ones a by-occurrence
// ranking would have put first, and they are the cheapest to misread.
const skewed = [...sites]
  .map(([cause, set]) => [cause, occurrences.get(cause) / set.size, set.size, occurrences.get(cause)])
  .filter(([, ratio, size]) => ratio > 20 && size > 0)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5);
if (skewed.length > 0) {
  console.log();
  console.log("  most repeated per site (a by-occurrence ranking would lead with these):");
  for (const [cause, ratio, size, occurs] of skewed) {
    console.log(`    ${occurs} occurrence(s) over ${size} site(s), ${ratio.toFixed(0)}x  ${cause.slice(0, 74)}`);
  }
}
