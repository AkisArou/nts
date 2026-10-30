// Does this change alter any answer? The examples differential, without the gate.
//
//   node tooling/differential/agree.mjs <nts>                 every example against node
//   node tooling/differential/agree.mjs <before> <after>      which answers <after> changed
//   node tooling/differential/agree.mjs <nts> --only=a,b      named examples only
//   node tooling/differential/agree.mjs --self-test
//
//   NTS_BACKEND, NTS_RC and NTS_POISON pass through to `nts check`, as in the gate.
//   NTS_AGREE_JOBS overrides the worker count.
//
// # Why
//
// Every other quick instrument counts *refusals*: the definitions floor,
// phantoms, the censuses of `runtime/node` and `runtime/web-platform`. A
// program that compiles and returns the wrong number moves none of them. On
// 2026-09-26 four such measurements called one commit clean, and the commit was
// reverted for a wrong answer that only the examples differential saw -- and
// the only thing running that was `tooling/gate/all.sh`, fifty minutes and a
// pinned tree away. Its stand-in was an `xargs` loop grepping for
// "disagree between", four times in one night. This is that loop, made into
// something you run *before* a commit.
//
// # What one example's run is
//
// Not a boolean. `nts check` says what happened, in the lines
// `tooling/cli/src/main.rs` `check` prints, and the record keeps all of it:
// the outcome, how many cases were compared out of how many the pool asked
// for, how many the compiled program declined, how many timed out, how many
// functions lowering refused, and the disagreeing and aborting lines
// themselves. Two binaries are compared on the whole record, so a change that
// adds four declines to an example that still prints `agreed on every case`
// is reported rather than passed. An abort hides exactly there: a decline is
// how the harness reads a program that stopped.
//
// # What it could not compare is a number, never a silence
//
// `nothing to check` and a partial comparison both exit 0 from `nts check`,
// and both used to read as agreement. The summary counts them apart, with the
// declined, timed-out and unreached cases summed across the corpus. An example
// the tool could not run at all is NOT MEASURED, printed with the first line
// of what the compiler said, and fails the run: a frontend that never started
// makes every example fail identically and must not read as a regression, nor
// as a pass.
//
// # The binary is pinned by content
//
// `target/release/nts` is whichever session built last, and it can be
// replaced halfway through a run. Each binary is copied by its sha256 into
// `~/.cache/nts-agree/bin/` before anything runs, and every case runs from the
// copy; the report names the hash, the source path and its mtime. Two
// arguments with the same hash are refused: that comparison can only say
// "nothing changed", whatever the change was.
//
// A pinned executable directory is pruned after a day unused, beyond the
// newest six. The native producer captures each requested program anew.
//
// # A difference is confirmed before it is attributed
//
// An example whose two records differ runs again under both binaries. If
// either binary disagrees with its own first run, the example is UNSTABLE --
// a timeout under load, a race in the program -- and is listed, not
// attributed. Otherwise the change is the binary's:
//
//   FIXED      after agrees and before did not, or it compares strictly more
//   REGRESSED  before agreed and after does not, or it compares strictly less
//   CHANGED    anything else: a different disagreement, a different refusal count
//
// FIXED prints and passes. REGRESSED, CHANGED, UNSTABLE and NOT MEASURED fail.
// An example that is wrong the same way under both is listed as *wrong under
// both* and does not fail an attribution run -- that is not this change's
// answer -- but it is never hidden.
//
// Exit 0: nothing wrong (one binary) or nothing made worse (two). Exit 1: a
// wrong answer, or a change. Exit 2: something could not be measured, or the
// tool could not start.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync,
  utimesSync, writeFileSync,
} from "node:fs";
import { availableParallelism, freemem, homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { withToken } from "../gate/tokens.mjs";
import { fileURLToPath } from "node:url";
import { armLines, oneChange } from "../conformance/pin.ts";
import { newlyRecordedProjects, newBeforeProject, fullyMeasuredAgreement } from "./new-projects.ts";
import { runCheck, reportCheckFailure, checkFailurePolicy, decodeCheck, Outcome } from "./check-report.ts";
export { Outcome } from "./check-report.ts";
import { comparisonOracleRoot } from "./legacy-oracle-root.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const CACHE = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "nts-agree");
/** Outcomes that are a wrong or missing answer about the program. */
const WRONG = new Set([
  Outcome.DISAGREES, Outcome.ABORTED, Outcome.ALL_DECLINED, Outcome.BACKEND_DECLINED, Outcome.INVALID_HIR,
  Outcome.NO_TYPECHECK,
]);
/** Outcomes that compared something and found no difference. */
const AGREEING = new Set([Outcome.AGREES, Outcome.PARTIAL]);

// Examples that exist *not* to be compared, each with its reason -- the same
// two the gate's `backend_examples` passes over.
const NOT_DIFFERENTIAL = new Map([
  ["invalid", "does not typecheck on purpose"],
  ["unsupported", "exists to document refusals"],
]);

/** Decode a completed check through its explicitly selected interface. */
export function classify(status, out, format = "json-v1", stderr = "") {
  return decodeCheck(format, status, out, stderr);
}

function unmeasuredRecord(status, error) {
  return {outcome: Outcome.NOT_MEASURED, status, checked: 0, expected: 0,
    declined: 0, unavailable: 0, timeouts: 0, refused: 0, refusedRoots: 0,
    answers: [], oracleStopped: 0, missingPopulation: null,
    first: String(error).slice(0, 120), incomplete: error};
}

/**
 * The line `tooling/gate/all.sh`'s `backend_examples` reads for one example:
 * `ok`, `partial <tab> why`, `bare`, `no` or `unmeasured <tab> why`, each
 * followed by the name.
 *
 * A projection of the record, and deliberately no more permissive than the
 * shell classifier it replaced. `no` counts against a floor that may have
 * slack, while `unmeasured` fails the step outright, so every outcome that
 * classifier failed outright stays `unmeasured` here. That means every case
 * declined, and any text it did not recognise.
 * `partial` keeps its gate meaning -- the program *declined* cases -- so the
 * step's ceiling counts what it always counted; a comparison short only of
 * timeouts or unreached cases is `ok` there, as it was.
 */
export function verdict(name, r) {
  switch (r.outcome) {
    case Outcome.AGREES:
      return `ok ${name}`;
    case Outcome.PARTIAL:
      return r.declined > 0
        ? `partial ${name}\t${[
          ...((r.report?.counts?.runtime_declined ?? r.declined - (r.unavailable ?? 0)) > 0
            ? [`${r.report?.counts?.runtime_declined ?? r.declined - (r.unavailable ?? 0)} runtime declines`] : []),
          ...(r.unavailable > 0 ? [`${r.unavailable} calls without compiled bindings`] : []),
          `${r.checked} of ${r.expected} compared`,
        ].join(", ")}`
        : `ok ${name}`;
    case Outcome.NOTHING:
      return `bare ${name}`;
    case Outcome.UNAVAILABLE:
      return `unavailable ${name}\t${r.unavailable} calls without compiled bindings; ${r.expected} Node calls measured`;
    case Outcome.DISAGREES:
    case Outcome.ABORTED:
    case Outcome.BACKEND_DECLINED:
    case Outcome.INVALID_HIR:
    case Outcome.NO_TYPECHECK:
      return `no ${name}`;
    default:
      return `unmeasured ${name}\t${r.outcome === Outcome.ALL_DECLINED ? "no case was checked: every case declined" : r.first.slice(0, 90)}`;
  }
}

/** Whether two records are the same answer. */
export function same(a, b) {
  // `oracleStopped` is left out: see `classify`.
  return a.outcome === b.outcome && a.checked === b.checked && a.expected === b.expected &&
    (a.format !== "json-v1" || b.format !== "json-v1" || a.unavailable === b.unavailable) &&
    a.declined === b.declined && a.timeouts === b.timeouts && a.refused === b.refused &&
    a.answers.join("\n") === b.answers.join("\n");
}

/**
 * FIXED, REGRESSED or CHANGED, for two records that are not `same`.
 *
 * Strictly better is narrow on purpose: an example that trades two declines
 * for one disagreement is not an improvement anybody should read past.
 */
export function attribute(before, after) {
  const agreeing = (r) => AGREEING.has(r.outcome);
  if (agreeing(after) && !agreeing(before)) return "FIXED";
  if (agreeing(before) && !agreeing(after)) return "REGRESSED";
  if (agreeing(before) && agreeing(after)) {
    // Each count in the direction that means "compared more". Fewer lowering
    // refusals and more cases compared is reach; the reverse is reach lost.
    const gains = [
      after.checked - before.checked, before.declined - after.declined,
      before.timeouts - after.timeouts, before.refused - after.refused,
    ];
    if (gains.every((g) => g >= 0) && gains.some((g) => g > 0)) return "FIXED";
    if (gains.every((g) => g <= 0) && gains.some((g) => g < 0)) return "REGRESSED";
  }
  return "CHANGED";
}

/** The comparison as one line: what an example compared, and what it could not. */
export function describe(r) {
  const parts = [r.outcome];
  if (r.expected > 0) parts.push(`${r.checked} of ${r.expected} compared`);
  if (r.declined > 0) parts.push(`${r.declined} declined`);
  if (r.timeouts > 0) parts.push(`${r.timeouts} timed out`);
  if (r.refused > 0) {
    const cascades = r.refused - r.refusedRoots;
    parts.push(`${r.refusedRoots} refused in lowering${cascades > 0 ? ` (${r.refused} with cascades)` : ""}`);
  }
  if (r.oracleStopped > 0) parts.push("node stopped part-way");
  if (r.outcome === Outcome.NOT_MEASURED) parts.push(r.first);
  return parts.join(", ");
}

// Exercise fields and mutations before collecting any corpus result.
function selfTest() {
  const value = (status, expected, compared, declined = 0, unavailable = 0) => ({
    version: 1, status, counts: { functions: expected ? 1 : 0, expected, compared,
      runtime_declined: declined, unavailable, timeouts: 0, approximated: 0, disagreements: 0, aborts: 0 },
    oracle: {expected, received: expected, complete: true}, refusals: [], disagreements: [], aborts: [], error: null,
  });
  const read = (report) => classify(["agrees", "partial", "nothing", "all_unavailable"].includes(report.status) ? 0 : 1, JSON.stringify(report));
  const agreed = read(value("agrees", 261, 261));
  if (agreed.outcome !== Outcome.AGREES || agreed.checked !== 261) return "agreement fields were not read";
  const partial = read(value("partial", 24, 20, 4));
  if (partial.outcome !== Outcome.PARTIAL || verdict("x", partial) !== "partial x\t4 runtime declines, 20 of 24 compared") return "decline fields were not read";
  const unavailable = read(value("all_unavailable", 3, 0, 0, 3));
  if (unavailable.outcome !== Outcome.UNAVAILABLE || unavailable.expected !== 3 || verdict("x", unavailable) !== "unavailable x\t3 calls without compiled bindings; 3 Node calls measured") return "unavailable bindings were treated as agreement";
  const every = read(value("all_declined", 3, 0, 3));
  if (!verdict("x", every).startsWith("unmeasured x\t")) return "runtime-only total decline was absorbed by the floor";
  const wrongValue = value("disagrees", 3, 3);
  wrongValue.counts.disagreements = 1;
  wrongValue.disagreements.push({compiled: "f 1 2", node: "f 1 3"});
  const wrong = read(wrongValue);
  if (wrong.outcome !== Outcome.DISAGREES || wrong.answers.length !== 2) return "structured disagreement was lost";
  const cascaded = value("agrees", 87, 87);
  cascaded.refusals = ["NTS1001", "NTS1003", "NTS1005"].map(code => ({stage: "lowering", code, message: "unavailable"}));
  const roots = read(cascaded);
  if (roots.refused !== 3 || roots.refusedRoots !== 1) return "diagnostic codes lost refusal roots";
  if (attribute(agreed, unavailable) !== "REGRESSED") return "lost bindings were not attributed as regression";
  if (attribute(partial, wrong) !== "REGRESSED") return "a disagreement was not attributed as regression";
  if (attribute(wrong, {...wrong, answers: ["different"]}) !== "CHANGED") return "changed answers were ignored";
  for (const mutation of ["agreed on every case\n", JSON.stringify({...value("agrees", 3, 3), version: 2}),
    JSON.stringify(value("agrees", 3, 0, 3))]) {
    let refused = false;
    try { classify(0, mutation); } catch { refused = true; }
    if (!refused) return "a legacy-text or contradictory JSON mutation was accepted";
  }
  return null;
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (args.includes("--self-test")) {
  console.log("  self-test: every outcome classified from structured fields, with malformed-output controls; declines under an agreement attributed as a regression");
  process.exit(0);
}

const verdictsFile = args.find((a) => a.startsWith("--verdicts="))?.slice("--verdicts=".length);
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length).split(",").filter(Boolean);
const comparisonBase = args.find((a) => a.startsWith("--base="))?.slice("--base=".length);
const binaries = args.filter((a) => !a.startsWith("--"));
if (binaries.length < 1 || binaries.length > 2) {
  console.log("  usage: agree.mjs <nts> [<nts-after>] [--only=example,...] [--verdicts=<file>] [--one-change] [--base=<before-commit>]");
  process.exit(2);
}
if (args.includes("--one-change")) {
  const why = binaries.length === 2 ? oneChange(binaries[0], binaries[1]) : "it compares two binaries and was given one";
  if (why) {
    console.log(`  NOT MEASURED: --one-change, and ${why}`);
    process.exit(2);
  }
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
/** Local time, as `ls` and `date` print it on this machine. */
const stamp = (ms) => {
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};
/** Repository-relative inside the tree, absolute outside it. */
const shown = (path) => {
  const rel = relative(ROOT, path);
  return rel === "" || rel.startsWith("..") ? path : rel;
};

/** Copy a binary to a path named by its content, and say what it was. */
function pin(path) {
  const source = resolve(path);
  if (!existsSync(source)) {
    console.log(`  NOT MEASURED: no compiler at ${path}`);
    process.exit(2);
  }
  const { mtimeMs } = statSync(source);
  const hash = sha256(source);
  const dir = join(CACHE, "bin", hash);
  const pinned = join(dir, "nts");
  if (!existsSync(pinned)) {
    mkdirSync(dir, { recursive: true });
    // Through a temporary name, so a run killed mid-copy leaves no truncated
    // binary under a name that claims its hash.
    const partial = join(dir, `nts.${process.pid}.partial`);
    copyFileSync(source, partial);
    chmodSync(partial, 0o755);
    renameSync(partial, pinned);
  }
  // The copy is what runs, so the copy is what is attested: a source
  // rebuilt between the hash and the copy would otherwise run unnamed.
  if (sha256(pinned) !== hash) {
    console.log(`  NOT MEASURED: ${path} changed while it was being pinned; run again`);
    process.exit(2);
  }
  // Marked used, for `prune`.
  const now = new Date();
  utimesSync(dir, now, now);
  return { source: shown(source), hash, built: stamp(mtimeMs), pinned };
}

/**
 * Remove pinned binaries, and their snapshot caches, unused for a day and
 * beyond the newest `keep`. A day, so a run another session has in flight
 * never loses the binary it is running.
 */
function prune(keep) {
  const bins = join(CACHE, "bin");
  if (!existsSync(bins)) return;
  const dayAgo = Date.now() - 86_400_000;
  readdirSync(bins)
    // Several runs prune at once -- a gate runs llvm, jvm and wasm side by
    // side, each through this tool -- so an entry listed here can be gone by
    // the time it is looked at. Gone is pruned, not an error: a `stat` that
    // threw on it stopped the wasm step with no verdict (7544cd297's train).
    .flatMap((name) => {
      const meta = statSync(join(bins, name), { throwIfNoEntry: false });
      return meta ? [{ path: join(bins, name), used: meta.mtimeMs }] : [];
    })
    .sort((a, b) => b.used - a.used)
    .slice(keep)
    .filter(({ used }) => used < dayAgo)
    .forEach(({ path }) => rmSync(path, { recursive: true, force: true }));
}

const pins = binaries.map(pin);
let newProjects = new Set();
if (comparisonBase !== undefined) {
  try {
    if (pins.length !== 2 || !comparisonBase) throw new Error("--base requires two binaries and a before commit");
    newProjects = newlyRecordedProjects(ROOT, binaries[0], comparisonBase, process.env.NTS_BACKEND || "c");
  } catch (error) {
    console.log(`  NOT MEASURED: ${error.message}`);
    process.exit(2);
  }
}
prune(6);
if (pins.length === 2 && pins[0].hash === pins[1].hash) {
  console.log(`  NOT MEASURED: both arguments are the same binary (sha256 ${pins[0].hash.slice(0, 16)}) --`);
  console.log("  that comparison can only answer \"nothing changed\"");
  process.exit(2);
}

const examples = readdirSync(join(ROOT, "tests/programs"), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(ROOT, "tests/programs", e.name, "tsconfig.json")))
  .map((e) => e.name)
  .filter((name) => !NOT_DIFFERENTIAL.has(name))
  .filter((name) => !only || only.includes(name))
  .sort();
const unknown = (only ?? []).filter((name) => !examples.includes(name));
if (unknown.length > 0) {
  console.log(`  NOT MEASURED: no such example(s): ${unknown.join(", ")}`);
  process.exit(2);
}
if (examples.length === 0) {
  console.log("  NOT MEASURED: no example to run");
  process.exit(2);
}

// Every temporary file under `~/.cache`, never `/tmp`: `/tmp` here is a tmpfs
// that fills, and runs out of inodes before it runs out of bytes.
mkdirSync(join(CACHE, "tmp"), { recursive: true });
const scratch = mkdtempSync(join(CACHE, "tmp", "run-"));
const env = { ...process.env, NTS_CHECKERS: "1", TMPDIR: scratch };
let oracleRoot;
try { oracleRoot = comparisonOracleRoot(ROOT, binaries, join(CACHE, "tmp")); }
catch (error) { console.log(`  NOT MEASURED: oracle compatibility: ${error.message}`); process.exit(2); }
process.on("exit", () => oracleRoot.dispose());
if (oracleRoot.legacy) console.log("  legacy oracle view: comparison-private checkout; removed after this run");
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));

// Each worker is a lowering, a clang build and a node process -- about a gigabyte
// at the top. Cores are rarely what this box runs out of.
const JOBS = Number(process.env.NTS_AGREE_JOBS ??
  Math.max(1, Math.min(8, availableParallelism(), Math.floor(freemem() / 1.5e9))));

/** One `nts check`, classified. */
const check = async (pinned, example) => {
  const checkEnv = {...env, NTS_GATE_CASE_BINARY_SHA: pinned.hash};
  delete checkEnv.NTS_GATE_STEP_RESULT;
  try {
    const {record, incomplete} = await runCheck(pinned.pinned, join("tests/programs", example, "tsconfig.json"), {
      cwd: oracleRoot.forBinary(binaries[pins.indexOf(pinned)]), env: checkEnv,
    });
    return {...record, incomplete};
  } catch (error) { return unmeasuredRecord(null, error); }
};

function incompleteExit(records, completedFailures) {
  const errors = records.filter(record => record.outcome === Outcome.NOT_MEASURED)
    .map(record => record.incomplete ?? new Error(record.first));
  const chosen = errors.find(error => checkFailurePolicy(error, completedFailures).disposition !== "verdict") ?? errors[0] ?? new Error("a comparison was incomplete");
  return reportCheckFailure(chosen, process.env, completedFailures);
}

// A count over this glob is a fact about the working tree, not a commit: say
// which examples only this tree has.
const tracked = new Set(
  execFileSync("git", ["ls-files", "-z", "tests/programs/*/tsconfig.json"], { cwd: ROOT, encoding: "utf8" })
    .split("\0").filter(Boolean).map((path) => path.split("/")[2]),
);
const untracked = examples.filter((name) => !tracked.has(name));

const configuration = [
  `backend ${process.env.NTS_BACKEND || "c"}`,
  `rc ${(process.env.NTS_RC ?? "0") !== "0" ? "on" : "off"}`,
  ...((process.env.NTS_POISON ?? "0") !== "0" ? ["poison on"] : []),
].join(", ");
pins.forEach((p, at) => {
  const role = pins.length === 1 ? "nts   " : at === 0 ? "before" : "after ";
  console.log(`  ${role} ${p.source}  sha256 ${p.hash.slice(0, 16)}  built ${p.built}`);
});
if (pins.length === 2) for (const line of armLines(pins[0].source, pins[1].source)) console.log(`  ${line}`);
console.log("  frontend compiled into each binary");
console.log(`  ${examples.length} example(s), ${JOBS} at a time, ${configuration}`);
if (untracked.length > 0) console.log(`  untracked, in this tree only: ${untracked.join(" ")}`);

const started = Date.now();
/** example -> [record under each binary] */
const runs = new Map();
let next = 0;
await Promise.all(Array.from({ length: Math.min(JOBS, examples.length) }, async () => {
  while (next < examples.length) {
    const example = examples[next++];
    // Both binaries run the same example consecutively in one worker.
    const records = [];
    // One of the gate's tokens per check (tokens.mjs).
    for (const p of pins) records.push(await withToken(() => check(p, example), { project: `tests/programs/${example}/tsconfig.json`, binary: p.hash }));
    runs.set(example, records);
  }
}));

const pad = (s, n) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const width = Math.min(48, Math.max(...examples.map((e) => e.length)) + 2);
const print = (tag, example, line) => console.log(`  ${pad(tag, 13)} ${pad(example, width)} ${line}`);
const printAnswers = (r) => r.answers.slice(0, 6).forEach((line) => console.log(`${" ".repeat(16)}${line}`));

/** Totals over one binary's records: what agreed, and what could not be compared. */
function summarise(records) {
  const by = (o) => records.filter((r) => r.outcome === o).length;
  const sum = (key) => records.reduce((a, r) => a + r[key], 0);
  const unreached = records.reduce((a, r) => a + Math.max(0, r.expected - r.checked - r.declined - r.timeouts), 0);
  const wrong = records.filter((r) => WRONG.has(r.outcome)).length;
  const stopped = records.filter((r) => r.oracleStopped > 0).length;
  console.log(`  ${by(Outcome.AGREES)} agree, ${by(Outcome.PARTIAL)} agree on part of their cases, ` +
    `${by(Outcome.NOTHING)} compared nothing, ${wrong} wrong, ${by(Outcome.NOT_MEASURED)} not measured`);
  console.log(`  ${sum("checked")} of ${sum("expected")} case(s) compared; not compared: ${sum("declined")} declined, ` +
    `${sum("timeouts")} timed out, ${unreached} unreached` +
    (stopped > 0 ? ` (node stopped part-way in ${stopped} example(s))` : ""));
}

const seconds = () => Math.round((Date.now() - started) / 1000);

if (verdictsFile) writeFileSync(verdictsFile, examples.map((e) => `${verdict(e, runs.get(e).at(-1))}\n`).join(""));

if (pins.length === 1) {
  const all = examples.map((e) => [e, runs.get(e)[0]]);
  for (const [example, r] of all) {
    if (WRONG.has(r.outcome)) {
      print("WRONG", example, describe(r));
      printAnswers(r);
    }
  }
  for (const [example, r] of all) if (r.outcome === Outcome.PARTIAL) print("partial", example, describe(r));
  for (const [example, r] of all) if (r.outcome === Outcome.NOTHING) print("nothing", example, "exports nothing the differential can drive");
  for (const [example, r] of all) if (r.outcome === Outcome.NOT_MEASURED) print("NOT MEASURED", example, r.first);
  summarise(all.map(([, r]) => r));
  const wrong = all.filter(([, r]) => WRONG.has(r.outcome)).length;
  const unmeasured = all.filter(([, r]) => r.outcome === Outcome.NOT_MEASURED).length;
  console.log(`  ${wrong === 0 && unmeasured === 0 ? "every example that compared anything agrees with node" : `${wrong} wrong, ${unmeasured} not measured`}, in ${seconds()} s`);
  process.exit(unmeasured > 0 ? incompleteExit(all.map(([, record]) => record), wrong) : wrong > 0 ? 1 : 0);
}

// Two binaries: confirm each difference, then attribute it.
const verdicts = [];
const differing = examples.filter((e) => !same(...runs.get(e)) || newBeforeProject(e, newProjects, runs.get(e)[0]));
for (const example of differing) {
  const [before, after] = runs.get(example);
  const again = [await check(pins[0], example), await check(pins[1], example)];
  const isNew = newBeforeProject(example, newProjects, before);
  const unfinished = [after, again[1], ...(!isNew ? [before, again[0]] : [])].filter(record => record.outcome === Outcome.NOT_MEASURED);
  if (unfinished.length) {
    verdicts.push({example, tag: "NOT MEASURED", before, after, unfinished});
    continue;
  }
  if (!same(before, again[0]) || !same(after, again[1]) || (isNew && !newBeforeProject(example, newProjects, again[0]))) {
    verdicts.push({ example, tag: "UNSTABLE", before, after, note: !same(before, again[0]) ? "before disagrees with itself" : "after disagrees with itself" });
    continue;
  }
  if (isNew) {
    const complete = fullyMeasuredAgreement(after) && fullyMeasuredAgreement(again[1]);
    verdicts.push({ example, tag: complete ? "NEW" : WRONG.has(after.outcome) ? "REGRESSED" : "NOT MEASURED", before, after,
      note: complete ? "before: not comparable (new)" : "new project's after arm must be fully measured and agree" });
    continue;
  }
  const tag = before.outcome === Outcome.NOT_MEASURED || after.outcome === Outcome.NOT_MEASURED ? "NOT MEASURED" : attribute(before, after);
  verdicts.push({ example, tag, before, after });
}
const ORDER = ["REGRESSED", "CHANGED", "UNSTABLE", "NOT MEASURED", "FIXED", "NEW"];
verdicts.sort((a, b) => ORDER.indexOf(a.tag) - ORDER.indexOf(b.tag) || a.example.localeCompare(b.example));
for (const v of verdicts) {
  print(v.tag, v.example, v.note ?? "");
  console.log(`${" ".repeat(16)}before: ${describe(v.before)}`);
  printAnswers(v.before);
  console.log(`${" ".repeat(16)}after:  ${describe(v.after)}`);
  printAnswers(v.after);
}
// Unchanged, and wrong or unmeasurable under both: not this change's answer,
// and not a silence either.
const bothWrong = examples.filter((e) => !differing.includes(e) && WRONG.has(runs.get(e)[1].outcome));
const bothUnmeasured = examples.filter((e) => !differing.includes(e) && runs.get(e)[1].outcome === Outcome.NOT_MEASURED);
for (const e of bothWrong) print("wrong, both", e, describe(runs.get(e)[1]));
for (const e of bothUnmeasured) print("NOT MEASURED", e, `under both: ${runs.get(e)[1].first}`);
console.log("  after:");
summarise(examples.map((e) => runs.get(e)[1]));
const count = (tag) => verdicts.filter((v) => v.tag === tag).length;
const failing = count("REGRESSED") + count("CHANGED") + count("UNSTABLE");
const unmeasured = count("NOT MEASURED") + bothUnmeasured.length;
console.log(`  ${examples.length - differing.length} unchanged, ${count("FIXED")} fixed, ${count("REGRESSED")} regressed, ` +
  `${count("CHANGED")} changed, ${count("UNSTABLE")} unstable, ${count("NEW")} not comparable (new), ${unmeasured} not measured, in ${seconds()} s`);
const unfinishedRecords = [
  ...verdicts.filter(v => v.tag === "NOT MEASURED").flatMap(v => v.unfinished ?? [v.before, v.after]),
  ...bothUnmeasured.map(example => runs.get(example)[1]),
];
process.exit(unmeasured > 0 ? incompleteExit(unfinishedRecords, failing) : failing > 0 ? 1 : 0);
