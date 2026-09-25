// Build a Test262 file, run it, and report what happened. A conformance run.
//
//   node tooling/census/run262.mjs [--under <prefix>] [--slice1] [--limit N]
//                                  [--selection <jsonl>] [--rows <jsonl>] [--json]
//
// This is the half `tooling/census/test262.mjs` deliberately does not do. The
// census compiles and records refusals; this compiles, **links, runs**, and
// reports a verdict.
//
// # Why so little machinery is needed
//
// `docs/conformance/test262.md` names four prerequisites for execution. Three
// were already met, verified end to end before this file was written:
//
//   a passing test    exit 0
//   a failing test    `nts: uncaught Test262Error: <message>` on stderr, exit 1
//
// Top-level statements lower into `module#init`; `emit-c --out <dir> --main`
// writes a `main.c` that calls it and drains the microtask queue; an uncaught
// throw prints the thrown value's **class name** — read from the descriptor, so
// a user subclass works — and calls `exit(1)` rather than `abort`, deliberately,
// so the status is observable and stdout is flushed. A positive Test262 test
// needs no `try`, so the cross-call `throw` refusal never fires: `assert` throws
// into top level with no handler at all.
//
// # What is claimed, and what is not
//
// **`strict-pass`, never a file pass.** Each file is run as one strict variant.
// `docs/conformance/test262.md` is explicit that a passing strict variant must
// not be promoted to a full-file result when the file's metadata also requires a
// sloppy one, and this reports the variant it ran.
//
// Scope-excluded by the scheduler: negative tests, `noStrict`, modules, raw.
// Excluded here: any test whose `includes:` names a harness file beyond the
// default `assert.js`/`sta.js` stand-in.
//
// **A compiler refusal is never a pass.** It is `unsupported` — the rule the
// protocol states and `verdict.rs` already has a test for.
//
// # What this cannot see
//
//   1. One strict variant per file. A file whose metadata also wants a sloppy
//      variant is not fully answered, and is not reported as if it were.
//   2. `strict-pass` means the program completed without throwing. A test that
//      passes vacuously — because an assertion it meant to make was refused
//      earlier and the statement dropped — would look identical. The sabotage
//      arm below is what keeps that honest.
//   3. The harness is a stand-in, not the harness.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { attempt, selfChecks } from "./attempt262.mjs";
import { pinCompiler, workspace } from "./project.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const SUITE = join(ROOT, "third_party/test262");
// **Per process, because two runs in one directory measure each other.**
// `attempt` writes `src/main.ts` and then compiles it, so two runs sharing a
// workspace race on that file: the compiler reads whichever body landed last,
// and both report a bucket for a program the other wrote. Two were found
// running at once here, started an hour apart, with no flag between them and
// nothing in either report to say so -- the outputs looked ordinary.
const SCRATCH =
  process.env.NTS_CENSUS_DIR ?? join(ROOT, "target/census/run262", String(process.pid));
const NTS = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
const CC = process.env.CC ?? "cc";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};
const under = flag("--under", "test/language/expressions");
const selectionFile = flag("--selection", null);
const rowsFile = flag("--rows", null);
const limit = Number(flag("--limit", "0")) || 0;
const slice1 = argv.includes("--slice1");
const asJson = argv.includes("--json");

function cannotMeasure(why) {
  console.log(`  INSTRUMENT FAILURE: ${why}`);
  console.log("  A run cannot report cleanly about programs it could not build.");
  process.exit(2);
}

if (!existsSync(NTS)) cannotMeasure(`no compiler at ${NTS}; set NTS_BIN`);
if (!existsSync(SUITE)) cannotMeasure("no test262 checkout; tooling/bootstrap/bootstrap.sh clones it");

// Copied, and every `attempt` runs the copy: a run measures one binary even
// though `target/release/nts` is the path everyone builds into. `pinCompiler`
// carries why.
const { path: PINNED, fingerprint: FINGERPRINT } = pinCompiler(NTS, SCRATCH);

// --- the selection --------------------------------------------------------

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

let records;
try {
  records = selection().split("\n").filter((line) => line !== "").map((line) => JSON.parse(line));
} catch (error) {
  cannotMeasure(`the selection could not be produced: ${String(error.message).split("\n")[0]}`);
}
if (records.length === 0) cannotMeasure(`${under} selected no test`);

/** Planned, positive, and needing no harness include beyond the stand-in. */
const runnable = (record) =>
  record.schedule === "planned" && record.includes.length === 0 && record.negative === undefined;

let chosen = records.filter(runnable);
if (slice1) chosen = chosen.filter((record) => record.function_token === false);
if (limit > 0) chosen = chosen.slice(0, limit);

// --- building and running one body ----------------------------------------
//
// `attempt` and the self-checks live in `attempt262.mjs`, shared with
// `conformance262.mjs`: one derivation of what a file did, not two.

const TOOLS = { nts: PINNED, cc: CC };

const checks = selfChecks(SCRATCH, TOOLS, cannotMeasure);

// --- the run ---------------------------------------------------------------

const dir = workspace(join(SCRATCH, "w0"));
if (rowsFile) writeFileSync(rowsFile, "");
const buckets = new Map();
const thrownBy = new Map();
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

for (const record of chosen) {
  const outcome = attempt(dir, readFileSync(join(SUITE, record.path), "utf8"), TOOLS);
  bump(buckets, outcome.bucket);
  if (outcome.bucket === "threw") bump(thrownBy, outcome.thrown);
  // **Appended as it is produced, not written at the end.** A full slice is
  // tens of minutes, and holding every row until the last one meant a run that
  // was killed -- or that this box killed -- left no rows at all and no way to
  // tell how far it had got. The file is also the only progress signal: `ps`
  // says a process exists, and the rows say it is moving.
  if (rowsFile) appendFileSync(rowsFile, `${JSON.stringify({ path: record.path, ...outcome })}\n`);
}

// --- the report ------------------------------------------------------------

const ran = [...buckets.values()].reduce((sum, count) => sum + count, 0);
const report = {
  pin: execFileSync("git", ["-C", SUITE, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  compiler: NTS,
  // The bytes, not the path. A path stays true while the binary behind it is
  // replaced, which is the whole reason the copy above exists.
  fingerprint: FINGERPRINT,
  under,
  slice: slice1 ? "slice1" : "positive-no-includes",
  selected: records.length,
  attempted: chosen.length,
  ran,
  checks,
  buckets: Object.fromEntries([...buckets].sort((a, b) => b[1] - a[1])),
  thrown: Object.fromEntries([...thrownBy].sort((a, b) => b[1] - a[1])),
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`  pin ${report.pin}`);
  console.log(`  compiler ${NTS} (sha256:${FINGERPRINT})`);
  console.log(`  ${under}: ${records.length} selected, ${chosen.length} attempted, ${ran} run`);
  console.log(
    `  self-checks: control ${checks.control}, sabotage ${checks.sabotage}, ` +
      `refused ${checks.refused}`,
  );
  for (const [name, count] of [...buckets].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(count).padStart(6)}  ${name}`);
  }
  for (const [name, count] of [...thrownBy].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(count).padStart(4)}  threw ${name}`);
  }
  if (ran !== chosen.length) {
    console.log(`  ${chosen.length - ran} attempted file(s) produced no bucket -- the run did not reconcile`);
  }
  console.log("  one strict variant per file: `strict-pass` is not a full-file pass");
}
