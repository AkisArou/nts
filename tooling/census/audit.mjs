// Every feature classification, checked against the suite and the ledger.
//
//   node tooling/census/audit.mjs [--selection <jsonl>] [--under <prefix>]
//
// `tooling/census/features.json` decides how a Test262 feature token is read:
// a §13 non-goal that will never be fixed, a gap that belongs in a backlog, a
// feature the ledger says already works, or a host capability. That file is an
// exclusion list, and an exclusion list nobody reads back is how a census comes
// to describe a corpus it is not measuring.
//
// `tooling/conformance/skip-audit.mjs` exists for exactly this reason on the
// Node corpus, and its opening sentence is the one worth repeating here: the
// entries "carry a reason each and are read by a person when they are written;
// nothing has ever read them back."
//
// Four questions. Three need no compiler and no census run, so they can be a
// gate step:
//
//   reason       an `inapplicable` row with no reason, or an authority that
//                names a document or section that does not exist. A non-goal
//                without a citation is indistinguishable from a gap somebody
//                gave up on.
//   registry     a row naming a feature Test262 no longer has. Upstream renames
//                tokens, and a row for a token nothing uses is a classification
//                that silently stops applying.
//   complete     a feature in the selection with no row. This is the one that
//                matters most: an unclassified feature would be counted as an
//                ordinary candidate, so a §13 non-goal would enter the backlog
//                as a gap.
//   unclaimed    a row matching no file in the selection. REPORTED, NOT FAILED
//                -- the first slice is `test/language/expressions` and `Proxy`
//                lives in `built-ins`, so most §13 rows are legitimately
//                unclaimed here. `stale-exclusions.mjs` records what it costs to
//                get this wrong: a population that was never read, reported as
//                a clean result.
//
// The fourth question -- is a classification WRONG -- needs a census artifact
// and is not here. It is the valuable one and it runs in both directions:
//
//   a file classed `inapplicable` that LOWERS    the classification is wrong
//   a file classed `supported` that ALL REFUSE   the LEDGER ROW is wrong
//
// The second is not hypothetical. `typescript.md`'s `namespace` row was ✅ and
// false until it was probed on 2026-09-14, and `x!` and decorators are ✗ rows
// that produce wrong answers rather than refusing.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const MAP = join(HERE, "features.json");
const SUITE = join(ROOT, "third_party/test262");
const REGISTRY = join(SUITE, "features.txt");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};
const under = flag("--under", "test/language/expressions");
const selectionFile = flag("--selection", null);
/**
 * Census rows, from `test262.mjs --rows`. Optional, because three of the four
 * questions need no compiler and this one does.
 */
const rowsFile = flag("--rows", null);

/**
 * An instrument failure is not a finding.
 *
 * Every question below would answer "clean" with no suite: no features in the
 * selection means nothing unclassified, and no registry means nothing stale.
 * That is a statement about this machine, not about the classifications, and
 * reporting it as a pass is the failure this whole census is built to avoid.
 */
function cannotMeasure(why) {
  console.log(`  INSTRUMENT FAILURE: ${why}`);
  console.log("  Every question below would answer cleanly, which would be a");
  console.log("  statement about this machine rather than about the feature map.");
  process.exit(2);
}

if (!existsSync(MAP)) cannotMeasure(`no feature map at ${MAP}`);
if (!existsSync(REGISTRY)) {
  cannotMeasure("no test262 checkout; tooling/bootstrap/bootstrap.sh clones it");
}

const map = JSON.parse(readFileSync(MAP, "utf8"));
const rows = map.features ?? {};
const CLASSES = new Set(["inapplicable", "gap", "supported", "host"]);

// The registry is `name` per line, with `#` comments -- whole-line *and
// trailing*, which is what the first version of this missed. Several entries
// carry a proposal URL after the name:
//
//   export-star-as-namespace-from-module  # https://github.com/tc39/ecma262/pull/1174
//
// Keeping the comment made the name a 60-character string that matched nothing,
// so the very first run reported a correctly-classified feature as absent from
// the registry. The check was right and the reader was wrong, which is the
// direction to prefer -- but it is still an instrument finding itself before it
// finds its subject.
const registry = new Set(
  readFileSync(REGISTRY, "utf8")
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line !== ""),
);

/** The selection, as JSON Lines, from the tool that owns the metadata parser. */
function selection() {
  if (selectionFile) return readFileSync(selectionFile, "utf8");
  return execFileSync(
    "cargo",
    [
      "run", "-q", "-p", "nts-suite", "--no-default-features",
      "--bin", "nts-test262-protocol", "--", "select", SUITE, under,
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
}

let lines;
try {
  lines = selection().split("\n").filter((line) => line !== "");
} catch (error) {
  cannotMeasure(`the selection could not be produced: ${error.message.split("\n")[0]}`);
}
if (lines.length === 0) cannotMeasure(`${under} selected no test`);

/** feature -> how many files in the selection declare it. */
const seen = new Map();
for (const line of lines) {
  for (const feature of JSON.parse(line).features ?? []) {
    seen.set(feature, (seen.get(feature) ?? 0) + 1);
  }
}

const problems = [];

// --- reason ---------------------------------------------------------------
for (const [name, row] of Object.entries(rows)) {
  if (!CLASSES.has(row.class)) {
    problems.push(`${name}: class ${JSON.stringify(row.class)} is not one of ${[...CLASSES].join(", ")}`);
    continue;
  }
  if (row.class !== "inapplicable") continue;
  if (!row.reason) {
    problems.push(`${name}: inapplicable with no reason -- a non-goal without one reads as a gap somebody gave up on`);
  }
  if (!row.authority) {
    problems.push(`${name}: inapplicable with no authority`);
    continue;
  }
  const [file, section] = row.authority.split(" §");
  const path = join(ROOT, file);
  if (!existsSync(path)) {
    problems.push(`${name}: authority names ${file}, which does not exist`);
  } else if (section) {
    const text = readFileSync(path, "utf8");
    if (!text.includes(`§${section}`) && !text.includes(`\n## ${section}.`)) {
      problems.push(`${name}: authority names §${section} of ${file}, which has no such section`);
    }
  }
}

// --- registry -------------------------------------------------------------
for (const name of Object.keys(rows)) {
  if (!registry.has(name)) {
    problems.push(`${name}: classified here but absent from features.txt at the pin -- upstream renamed or removed it`);
  }
}

// --- complete -------------------------------------------------------------
for (const [name, count] of seen) {
  if (!(name in rows)) {
    problems.push(`${name}: ${count} file(s) in ${under} declare it and it has no row -- it would enter the backlog unclassified`);
  }
}

// --- wrong, in either direction (needs a census artifact) ------------------
//
// The three questions above ask whether the map is *well formed*. This asks
// whether it is *true*, and it is the one worth having: a classification nobody
// can contradict is an opinion with a schema.
//
// Advisory, because it needs a run and because a `supported` feature can
// legitimately have every file blocked by something else in the same file --
// the compiler reports one blocker at a time, so a refusal naming feature B
// says nothing about feature A appearing beside it. Reported, never failed.
const contradictions = [];
if (rowsFile) {
  if (!existsSync(rowsFile)) cannotMeasure(`no census rows at ${rowsFile}`);
  const census = readFileSync(rowsFile, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
  if (census.length === 0) cannotMeasure(`${rowsFile} holds no rows`);
  /** feature -> { lowered, refused, total } over the files declaring it. */
  const tally = new Map();
  for (const row of census) {
    for (const feature of row.features ?? []) {
      const at = tally.get(feature) ?? { lowered: 0, refused: 0, total: 0 };
      at.total += 1;
      if (row.bucket === "lowers") at.lowered += 1;
      if (row.bucket === "unsupported") at.refused += 1;
      tally.set(feature, at);
    }
  }
  for (const [name, at] of tally) {
    const row = rows[name];
    if (!row) continue;
    if (row.class === "inapplicable" && at.lowered > 0) {
      contradictions.push(
        `${name}: classified inapplicable (${row.reason}) and ${at.lowered} of ${at.total} file(s) LOWER ` +
          "-- a §13 non-goal that compiles is a classification, not a principle",
      );
    }
    if (row.class === "supported" && at.lowered === 0 && at.refused > 0) {
      contradictions.push(
        `${name}: classified supported and 0 of ${at.total} file(s) lower, ${at.refused} refuse ` +
          "-- check the ledger row before trusting it",
      );
    }
  }
}

// --- unclaimed (reported, never failed) -----------------------------------
const unclaimed = Object.keys(rows).filter((name) => !seen.has(name));

const byClass = new Map();
for (const row of Object.values(rows)) {
  byClass.set(row.class, (byClass.get(row.class) ?? 0) + 1);
}

console.log(`  ${lines.length} file(s) under ${under}; ${seen.size} distinct feature(s) declared`);
console.log(
  `  ${Object.keys(rows).length} classified: ` +
    [...byClass].sort().map(([name, count]) => `${count} ${name}`).join(", "),
);
if (unclaimed.length > 0) {
  // Printed with the population, because the failure this guards against is a
  // list that was never read rather than a list that is wrong.
  console.log(
    `  ${unclaimed.length} row(s) match no file here, which is expected while the ` +
      `population is ${under} only:`,
  );
  console.log(`    ${unclaimed.join(" · ")}`);
}
if (contradictions.length > 0) {
  console.log(`  ${contradictions.length} classification(s) the census contradicts:`);
  for (const line of contradictions) console.log(`    ${line}`);
} else if (rowsFile) {
  console.log("  no classification contradicted by the census");
}
if (problems.length > 0) {
  console.log(`  ${problems.length} problem(s):`);
  for (const problem of problems) console.log(`    ${problem}`);
}
process.exitCode = problems.length > 0 ? 1 : 0;
