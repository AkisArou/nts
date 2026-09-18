// Why the compiler refuses each Test262 file. A census, never a verdict.
//
//   node tooling/census/test262.mjs [--under <prefix>] [--slice1] [--limit N]
//                                   [--selection <jsonl>] [--json]
//
// `NTS_CENSUS_EXPLAIN=1` dumps the raw compiler output for any file the
// reader could not classify, which is how the five-digit `TS18050` was found.
//
// This compiles a slice of Test262 and records *why* each file fails to lower.
// It never runs a test, never compares an answer, and never produces a Test262
// verdict. `docs/conformance/test262.md` states the rule it is obeying: "no
// compiler refusal can be promoted to a Test262 verdict". The words `pass`,
// `fail` and `conformance` do not belong in its output.
//
// # Why bother, with 257 hand-written examples already
//
// Because they cover the ordinary middle. Six defects were found in one night
// by writing ten-line fixtures for shapes nobody had written down, and three of
// them scored *zero sites* in the existing refusal census -- every function that
// would have reached them stopped earlier on something else.
// `test/language/expressions` is 11,102 files that enumerate the corners of the
// language on purpose. It is the corpus that instrument has been missing.
//
// # What it cannot see -- printed on every run, not left to a reader
//
//   1. Nothing is executed. `lowers` means the compiler accepted the program,
//      NOT that it computes the right answer. A file in that bucket may still
//      be wrong and this cannot tell.
//   2. Only the FIRST blocking diagnostic per file is ranked. The compiler
//      reports one blocker at a time, so a ranking is by *reach*, not by cause.
//      A row is where reducing starts, not a defect.
//   3. A file whose features class it `inapplicable` is still compiled -- the
//      class is a column, never a filter -- but a file that never typechecks
//      says nothing about the lowering behind it.
//   4. The harness is a stand-in (`harness.ts`), not the harness. A test whose
//      `includes:` names `propertyHelper.js` or `compareArray.js` is outside
//      the slice this can speak about.
//   5. Diagnostic lines that did not parse are counted and printed. Unparsed
//      lines make the corpus look LESS blocking, so the direction matters.
//
// # The self-checks, which run before the census does
//
// A control file that must lower, a sabotage arm, and a footer reconciliation
// per file. Each exists because its absence produced a clean-looking table that
// measured nothing somewhere else in this repository.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const SUITE = join(ROOT, "third_party/test262");
const HARNESS = readFileSync(join(HERE, "harness.ts"), "utf8");
const SCRATCH = process.env.NTS_CENSUS_DIR ?? join(ROOT, "target/census/test262");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};
const under = flag("--under", "test/language/expressions");
const selectionFile = flag("--selection", null);
/**
 * Where to write one JSON object per file compiled.
 *
 * The aggregate answers "what blocks this corpus". The rows answer a question
 * the aggregate cannot: **is a classification wrong**. A file whose features
 * class it `inapplicable` and which nonetheless lowers proves the class wrong;
 * a `supported` feature all of whose files refuse proves the *ledger row*
 * wrong. Neither is visible without the per-file join, and the second is not
 * hypothetical -- `typescript.md`'s `namespace` row was ✅ and false.
 */
const rowsFile = flag("--rows", null);
const limit = Number(flag("--limit", "0")) || 0;
const slice1 = argv.includes("--slice1");
const asJson = argv.includes("--json");
// Serial, deliberately and visibly. `execFileSync` is synchronous, so a
// worker pool is a rewrite of the loop rather than a flag -- and a `--jobs`
// option that was accepted, reported, and did nothing would describe a run
// that never happened. Roughly 0.4s a file: the 2,527-file slice is about
// twenty minutes, which is a background run rather than a gate step.

/**
 * The compiler under test, named rather than assumed.
 *
 * `target/release/nts` is a shared working tree in this repository, so a census
 * that does not say which binary it ran is a measurement with no provenance.
 * The mtime goes in the report for the same reason.
 */
const NTS = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");

function cannotMeasure(why) {
  console.log(`  INSTRUMENT FAILURE: ${why}`);
  console.log("  A census cannot report cleanly about a run it could not make.");
  process.exit(2);
}

if (!existsSync(NTS)) cannotMeasure(`no compiler at ${NTS}; set NTS_BIN`);
if (!existsSync(SUITE)) cannotMeasure("no test262 checkout; tooling/bootstrap/bootstrap.sh clones it");

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

/**
 * Slice 1: planned, no harness include, no function token, positive.
 *
 * No unannotated parameter means no implicit `any`, so a refusal in this slice
 * is a lowering gap rather than the typecheck wall. It is the slice worth
 * running before `NeedsRepresentation` exists.
 */
const inSlice1 = (record) =>
  record.schedule === "planned" &&
  record.includes.length === 0 &&
  record.function_token === false &&
  record.negative === undefined;

let planned = records.filter((record) => record.schedule === "planned");
if (slice1) planned = planned.filter(inSlice1);
if (limit > 0) planned = planned.slice(0, limit);

const excluded = records.filter((record) => record.schedule !== "planned");

// --- compiling one file ---------------------------------------------------

/** `  -- <path>:<line>:<col> NTS#### <message>` on stdout, from `dump_hir`. */
const NTS_LINE = /^\s*--\s+\S+?:\d+:\d+\s+(NTS\d{4})\s+(.*)$/;
/**
 * `TS#### <message>`, printed when the program does not typecheck.
 *
 * **Four OR five digits.** `TS18050` exists ("The value 'undefined' cannot be
 * used here") and is common in this corpus, because Test262 tests coercion on
 * purpose. A `\d{4}` pattern matched `TS1805` and then failed on the `0`, so
 * seven of the first sixty files parsed as having no diagnostics at all.
 *
 * They landed in `infrastructure-error` rather than in `lowers` only because
 * the catch-all was written to distrust itself. Had it defaulted the other way,
 * a reader bug would have inflated the healthy bucket by 12% and nothing would
 * have said so.
 */
const TS_LINE = /^(TS\d{4,5})\s+(.*)$/;
/** `N function(s), M construct(s) refused` -- the footer this reconciles against. */
const FOOTER = /^(\d+) function\(s\), (?:(\d+) construct\(s\) refused|nothing refused)$/;

function workspace(worker) {
  const dir = join(SCRATCH, `w${worker}`);
  mkdirSync(join(dir, "src"), { recursive: true });
  // Options inlined rather than `extends`-ed. A copied fixture config's
  // relative `extends` resolves to nothing, silently, and the options vanish --
  // which has cost this repository a probe that measured a different language
  // than it meant to.
  writeFileSync(
    join(dir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          strict: true,
          noEmit: true,
        },
        include: ["src"],
      },
      null,
      2,
    )}\n`,
  );
  return dir;
}

function compile(dir, source) {
  // The harness is prepended, so the unit stays a script: an `import` would
  // make it a module and change top-level `var` scoping and `this`.
  writeFileSync(join(dir, "src", "main.ts"), source);
  try {
    return {
      out: execFileSync(NTS, ["hir", join(dir, "tsconfig.json"), "--prepared"], {
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 64 * 1024 * 1024,
        // `execFileSync` pipes stdout and lets **stderr reach the parent**, so
        // without this the child's `Error: the program does not typecheck`
        // scrolls past the census instead of being classified by it -- a
        // diagnostic the reader never sees is a diagnostic the reader cannot
        // count.
        stdio: ["ignore", "pipe", "pipe"],
        // The cache key is the tsconfig *path*, and every worker reuses one
        // path for thousands of different programs. `cache.rs` records what
        // that costs: two projects hashing to one entry, the second handed the
        // first's program, surfacing only because an unrelated check happened
        // to catch it.
        env: { ...process.env, NTS_NO_SNAPSHOT_CACHE: "1" },
      }),
      failed: false,
    };
  } catch (error) {
    // `hir` exits non-zero when the program does not typecheck, and its
    // diagnostics are on stdout. A non-zero exit is not an absence of output.
    return { out: `${error.stdout ?? ""}${error.stderr ?? ""}`, failed: true, error };
  }
}

/** One file's outcome, and never its exit status. */
function classify(result) {
  const lines = result.out.split("\n");
  const ts = [];
  const nts = [];
  let footer = null;
  for (const line of lines) {
    const asTs = TS_LINE.exec(line.trim());
    if (asTs) {
      ts.push({ code: asTs[1], message: asTs[2] });
      continue;
    }
    const asNts = NTS_LINE.exec(line);
    if (asNts) {
      nts.push({ code: asNts[1], message: asNts[2] });
      continue;
    }
    const asFooter = FOOTER.exec(line.trim());
    if (asFooter) footer = { functions: Number(asFooter[1]), refused: Number(asFooter[2] ?? 0) };
  }
  if (result.error?.signal === "SIGTERM") return { bucket: "timeout", ts, nts, footer };
  // **A frontend panic is not a compiler refusal and must not be counted as
  // one.** Found on the first full run: 18 files in slice 1 crash `tsgo` with
  //
  //   panic: Debug failure. False expression: Trying to get the type of
  //   `import.defer` in `import.defer(...)`
  //
  // out of `getSymbolsAtLocations`. That is a defect in the vendored
  // typescript-go, not a gap in this compiler, and folding it into either the
  // refusal ranking or the typecheck column would attribute an upstream crash
  // to the lowering.
  if (result.out.includes("frontend transport failed") || result.out.includes("panic: ")) {
    return { bucket: "frontend-crash", ts, nts, footer };
  }
  if (result.out.includes("invalid HIR:")) return { bucket: "invalid-hir", ts, nts, footer };
  if (ts.length > 0) return { bucket: `ts:${ts[0].code}`, ts, nts, footer };
  if (nts.length > 0) return { bucket: "unsupported", ts, nts, footer };
  if (footer && footer.functions > 0) return { bucket: "lowers", ts, nts, footer };
  // Exit 0, no diagnostics, and nothing lowered is not a pass; it is output
  // this reader did not understand.
  return { bucket: "infrastructure-error", ts, nts, footer };
}

// --- the self-checks, before the census ------------------------------------

const CONTROL = `const a = 1 + 1;\nif (a !== 2) { throw new Error("control"); }\n`;

function selfChecks() {
  const dir = workspace("control");
  const control = classify(compile(dir, `"use strict";\n${HARNESS}${CONTROL}`));
  if (control.bucket !== "lowers") {
    cannotMeasure(
      `the control program does not lower (${control.bucket}). ` +
        "The materialiser is wrong, not the compiler -- a control is chosen " +
        "because you believe it works, which is why nobody ever runs it.",
    );
  }
  // Sabotage: a program that must NOT lower. If this also reports `lowers`,
  // the reader is not reading.
  //
  // **An unused `const v: any = 1` is not it, and that was the first attempt.**
  // It lowers -- the binding is dead, so nothing ever reads it as an `any` and
  // the lowerer never meets one. The arm fired on its first run and stopped the
  // census, which is what an arm is for, but the thing it caught was the choice
  // of sabotage rather than the reader. An `any` *parameter* is the shape the
  // census is actually about, and it refuses.
  const mutated = classify(
    compile(dir, `"use strict";\n${HARNESS}function f(x: any): number { return x + 1; }\nif (f(1) !== 2) { throw new Error("s"); }\n`),
  );
  if (mutated.bucket === "lowers") {
    cannotMeasure(
      "a program using `any` reported as lowering, so the outcome does not " +
        "depend on the input. A check whose answer does not depend on its " +
        "input is not a check.",
    );
  }
  return { control: control.bucket, sabotage: mutated.bucket };
}

const checks = selfChecks();

// --- the run ---------------------------------------------------------------

const buckets = new Map();
const firstRefusal = new Map();
const tsCodes = new Map();
let unparsed = 0;
let compared = 0;
/**
 * Files the reader could not classify, by name.
 *
 * A count alone is unactionable, and this bucket is where a reader bug hides:
 * the five-digit `TS18050` sat here as seven files before anyone looked. Naming
 * them is what turns "0.7% unexplained" into a list somebody can open.
 */
const unclassified = [];
/** One record per file compiled, written only when `--rows` asks. */
const rows = [];

const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

/** Group a refusal by the things it names, so one cause is one row. */
const shape = (message) => message.replace(/`[^`]*`/g, "`X`").replace(/\s+/g, " ").trim();

const dir = workspace(0);
for (const record of planned) {
  const source = `"use strict";\n${HARNESS}${readFileSync(join(SUITE, record.path), "utf8")}`;
  const outcome = classify(compile(dir, source));
  compared += 1;
  if (rowsFile) {
    rows.push({
      path: record.path,
      bucket: outcome.bucket,
      features: record.features,
      first: outcome.nts[0]?.message ?? outcome.ts[0]?.code ?? null,
    });
  }
  if (outcome.bucket === "infrastructure-error") unclassified.push(record.path);
  if (outcome.bucket === "infrastructure-error" && process.env.NTS_CENSUS_EXPLAIN) {
    console.error(`--- ${record.path} ---`);
    console.error(JSON.stringify({ footer: outcome.footer, ts: outcome.ts.length, nts: outcome.nts.length }));
    console.error(compile(dir, source).out.split("\n").slice(-8).join("\n"));
  }
  bump(buckets, outcome.bucket);
  if (outcome.bucket === "unsupported") bump(firstRefusal, shape(outcome.nts[0].message));
  if (outcome.bucket.startsWith("ts:")) bump(tsCodes, outcome.ts[0].code);
  // The footer states the compiler's own count. A reader that drops what it
  // cannot match makes the corpus look less blocking, and nothing says so.
  if (outcome.footer && outcome.footer.refused !== outcome.nts.length) unparsed += 1;
}

// --- the report ------------------------------------------------------------

const ranked = [...firstRefusal.entries()].sort((a, b) => b[1] - a[1]);
const report = {
  pin: execFileSync("git", ["-C", SUITE, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  compiler: NTS,
  under,
  slice: slice1 ? "slice1" : "planned",
  selected: records.length,
  excluded: excluded.length,
  compared,
  checks,
  buckets: Object.fromEntries([...buckets].sort((a, b) => b[1] - a[1])),
  ts_codes: Object.fromEntries([...tsCodes].sort((a, b) => b[1] - a[1])),
  first_refusal: Object.fromEntries(ranked),
  unparsed,
  unclassified,
};

if (rowsFile) {
  writeFileSync(rowsFile, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`  pin ${report.pin}`);
  console.log(`  compiler ${NTS}`);
  console.log(`  ${under}: ${records.length} selected, ${excluded.length} excluded, ${compared} compiled`);
  console.log(`  self-checks: control ${checks.control}, sabotage ${checks.sabotage}`);
  console.log("  outcomes:");
  for (const [name, count] of [...buckets].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(count).padStart(6)}  ${name}`);
  }
  if (ranked.length > 0) {
    console.log(`  first refusal, ${Math.min(20, ranked.length)} of ${ranked.length} distinct:`);
    for (const [message, count] of ranked.slice(0, 20)) {
      console.log(`    ${String(count).padStart(6)}  ${message.slice(0, 96)}`);
    }
  }
  if (unclassified.length > 0) {
    console.log(`  ${unclassified.length} file(s) the reader could not classify:`);
    for (const path of unclassified.slice(0, 10)) console.log(`    ${path}`);
    if (unclassified.length > 10) console.log(`    ... and ${unclassified.length - 10} more`);
  }
  if (unparsed > 0) {
    console.log(`  ${unparsed} file(s) whose diagnostics did not reconcile with the compiler's own count`);
    console.log("    (unparsed lines make the corpus look LESS blocking, not more)");
  }
  console.log("  this compiles and does not run: `lowers` is not `correct`, and nothing here is a verdict");
}
