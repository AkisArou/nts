// The compiled axis, held per module: no module passes fewer of node's own
// tests as a compiled addon than its row in `compiled-axis.floor`.
//
//   node tooling/conformance/compiled-axis-floor.mjs              run the axis, then judge it
//   node tooling/conformance/compiled-axis-floor.mjs --from <log> judge a saved run
//   node tooling/conformance/compiled-axis-floor.mjs --record ... write the table from a run
//   NTS_BIN=<a pinned copy> node tooling/conformance/compiled-axis-floor.mjs
//
// # Why
//
// `compiled-axis.sh` is the only thing in the tree that compares a compiled
// runtime module's *behaviour* with node: node's test suite against each
// addon, twice, keeping only the passes that do not survive emptying the
// module's exports. Nothing ran it for two weeks. Its first run since read
// 48 against September's 46, and the aggregate hid a regression: `assert`
// had lost its entire surface. 0e4344a59 rightly refuses `Assert#constructor`
// (a method handed out unbound), so the statement that builds the exports is
// cut and `require('assert')` has no keys. A total that improves is not
// evidence about its parts. So this holds each module to its own row.
//
// Lane-local, not a gate step: the run is about 16 minutes. The surface check
// that caught `assert` -- does the addon publish anything -- lives in
// `build-floor.sh`, where it costs nothing.
//
// # The rule
//
// A module whose real passes went **down** fails, named. A module the table
// has that the run does not, or that will not load, fails. A module that went
// **up** prints a note and passes: newly passing, and the row is raised once
// each is known to belong, never because of the number. An improvement in a
// reach-shaped number can be the symptom rather than the result: on
// 2026-09-27 an unsound change read +146 definitions.
//
// # What a row is
//
// `compiled-axis.sh`'s real passes: a pass that also passes with the module's
// exports emptied asserts nothing about it and is not counted. It prints a
// module in one of four shapes, all read here:
//
//   stream       271 file(s): 1 passed, 251 failed, ...        1
//   fs           3 real, 1 hollow, 347 failed                  3
//   timers       PUBLISHES NOTHING -- 2 real pass(es), ...     2
//   process      WILL NOT LOAD -- ...                          not measured

import { activeCommand, CommandNotMeasuredError } from "../gate/active-command.ts";
import { ToolingInstrumentError } from "../gate/step-result.ts";
import { reportCheckFailure, checkFailurePolicy } from "../differential/check-report.ts";
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAxis, AXIS_PREFIX, axisFailure } from "./compiled-axis-rows.mjs";
import { nodeEnvironment } from "./node-environment.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const TABLE = join(HERE, "compiled-axis.floor");
const argv = process.argv.slice(2);
const recording = argv.includes("--record");
let runScratch = null;
const from = argv.includes("--from") ? argv[argv.indexOf("--from") + 1] : null;

// **Seen to read every shape before it is trusted**, on the lines the script prints.
function selfTest() {
  const report = (verdicts, supervision = []) => ({ version: 1, module: "control", expected: verdicts.length,
    rows: verdicts.map((kind, i) => ({ name: `file-${i}`, kind })),
    tally: Object.fromEntries(["pass", "fail", "skip", "n/a", "not-measured"].map(kind => [kind, verdicts.filter(k => k === kind).length])), supervision });
  const record = (intact, empty) => AXIS_PREFIX + JSON.stringify({ version: 1, module: "control", kind: "files", intact, empty });
  const measured = readAxis(record(report(["pass", "pass"]), report(["fail", "pass"])));
  if (measured.get("control")?.real !== 1 || measured.get("control")?.hollow !== 1) return "per-file pass intersection was misread";
  for (const verdicts of [["not-measured"], ["fail", "not-measured"]]) {
    const stop = { name: `file-${verdicts.length - 1}`, kind: "hung", reason: "control stalled" };
    const row = readAxis(record(report(verdicts, [stop]), report(verdicts.map(() => "fail")))).get("control");
    if (row?.real !== undefined || !row?.unmeasured) return "an incomplete arm was counted";
    if (checkFailurePolicy(axisFailure(row), row.completedFailures).disposition !== (verdicts.length === 1 ? "operator-hold" : "verdict")) return "failure/hang precedence changed";
  }
  if (readAxis("control 200 real, 0 hollow, 0 failed").size) return "prose authorized a measurement";
  for (const phase of ["build", "load"]) {
    const row = readAxis(AXIS_PREFIX + JSON.stringify({ version: 1, module: "control", kind: "artifact-failure", phase, status: 7, signal: null, reason: `${phase} failed` })).get("control");
    if (!row?.failed || row?.unmeasured || row?.real !== undefined) return "completed artifact failure was held or counted";
  }
  return undefined;
}

const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (argv.includes("--self-test")) {
  console.log("  self-test: structured pass intersection, incomplete-arm hold, failure-before-hang, prose rejected");
  process.exit(0);
}

/** Run compiled-axis.sh pinned and isolated, returning its output. */
async function runAxis() {
  const source = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
  if (!existsSync(source)) {
    console.log(`  NOT MEASURED: no compiler at ${source}; set NTS_BIN`);
    process.exit(reportCheckFailure(new ToolingInstrumentError("tooling-setup", `no compiler at ${source}`)));
  }
  const base = join(homedir(), ".cache/nts-compiled-axis");
  mkdirSync(base, { recursive: true });
  const scratch = mkdtempSync(join(base, "run-"));
  runScratch = scratch;
  console.log(`  per-file axis artifacts: ${scratch}`);
  // Pinned: a peer relinking target/release/nts mid-run rebuilds half the
  // modules with another compiler. Every cache and temporary file private:
  // the default snapshot cache is shared by every lane on the box.
  const nts = join(scratch, "nts");
  copyFileSync(source, nts);
  chmodSync(nts, 0o755);
  for (const d of ["addons", "tmp"]) mkdirSync(join(scratch, d));
  console.log(`  running compiled-axis.sh against ${source} (pinned); about 16 minutes`);
  const env = nodeEnvironment(process.env, { NTS_BIN: nts, NTS_ADDON_OUT: join(scratch, "addons"), TMPDIR: join(scratch, "tmp") });
  writeFileSync(join(scratch, "environment.json"), JSON.stringify(env, null, 2) + "\n");
  const run = await activeCommand("bash", [join(HERE, "compiled-axis.sh")], {
    cwd: ROOT,
    maxBuffer: 1 << 26,
    env,
  });
  if (run.hung || run.runaway) throw new CommandNotMeasuredError(run);
  if (run.error || run.signal || run.status === null) throw new ToolingInstrumentError("tooling-setup", `axis did not complete: ${run.error?.message ?? run.signal}`);
  return run.stdout;
}

let axis;
try {
  const text = from ? readFileSync(from, "utf8") : await runAxis();
  axis = readAxis(text);
} catch (error) {
  console.log(`  NOT MEASURED: ${error.message}`);
  process.exit(reportCheckFailure(error));
}
if (axis.size === 0) {
  console.log("  NOT MEASURED: the run printed no module rows");
  process.exit(reportCheckFailure(new ToolingInstrumentError("tooling-setup", "axis printed no structured module records")));
}

if (recording) {
  if ([...axis.values()].some(row => row.failed)) {
    console.log("  not recorded: a module failed to build or load"); process.exit(1);
  }
  const unmeasured = [...axis].filter(([, r]) => r.unmeasured);
  if (unmeasured.length > 0) {
    console.log(`  not recorded: ${unmeasured.map(([m]) => m).join(", ")} did not load`);
    const failure = axisFailure(unmeasured[0][1]);
    process.exit(reportCheckFailure(failure, process.env, unmeasured.reduce((sum, [, row]) => sum + row.completedFailures, 0)));
  }
  const header = existsSync(TABLE) ? readFileSync(TABLE, "utf8").split("\n").filter((l) => l.startsWith("#")) : [
    "# Real passes of node's own tests per runtime/node module as a compiled addon,",
    "# from tooling/conformance/compiled-axis.sh (passes that survive emptying the",
    "# module's exports are not counted). Held by compiled-axis-floor.mjs: a drop",
    "# fails, a rise is a note -- raise a row once each new pass is known to belong.",
  ];
  const rows = [...axis].sort(([a], [b]) => a.localeCompare(b)).map(([m, r]) => `${m} ${r.real}`);
  writeFileSync(TABLE, `${[...header, ...rows].join("\n")}\n`);
  console.log(`  recorded ${rows.length} module(s) to tooling/conformance/compiled-axis.floor`);
  if (runScratch) rmSync(runScratch, { recursive: true, force: true });
  process.exit(0);
}

if (!existsSync(TABLE)) {
  console.log("  NOT MEASURED: no tooling/conformance/compiled-axis.floor; run with --record first");
  process.exit(reportCheckFailure(new ToolingInstrumentError("tooling-setup", "missing compiled axis floor")));
}
const table = new Map(
  readFileSync(TABLE, "utf8").split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => l.trim().split(/\s+/)).map(([m, n]) => [m, Number(n)]),
);
const failures = [];
const notes = [];
const incomplete = [];
let completedFailures = 0;
for (const [module, was] of table) {
  const now = axis.get(module);
  if (!now) incomplete.push(new ToolingInstrumentError("tooling-setup", `${module}: in the table, not in the run`));
  else if (now.unmeasured) {
    incomplete.push(axisFailure(now)); completedFailures += now.completedFailures;
    console.log(`  NOT MEASURED ${module}: ${now.unmeasured}`);
  }
  else if (now.failed) failures.push(`${module}: ${now.failed}`);
  else if (now.real < was) failures.push(`${module}: ${was} -> ${now.real} real pass(es), ${now.real - was}`);
  else if (now.real > was) notes.push(`${module}: ${was} -> ${now.real}, +${now.real - was} -- newly passing; raise the row once each is known to belong`);
}
for (const [module] of axis) if (!table.has(module)) failures.push(`${module}: in the run, no row in the table -- add one`);
const total = [...axis.values()].reduce((a, r) => a + (r.real ?? 0), 0);
console.log(`  ${axis.size} module(s), ${total} real pass(es)`);
for (const n of notes) console.log(`  up        ${n}`);
for (const f of failures) console.log(`  DOWN      ${f}`);
console.log(incomplete.length ? `  ${incomplete.length} module(s) not measured` : failures.length === 0 ? "  no module passes fewer of node's tests than its row" : `  ${failures.length} failure(s)`);
if (incomplete.length) {
  if (runScratch) console.log(`  kept axis artifacts: ${runScratch}`);
  completedFailures += failures.length;
  const failure = incomplete.find(error => checkFailurePolicy(error, completedFailures).disposition === "operator-hold") ?? incomplete.find(error => checkFailurePolicy(error, completedFailures).disposition !== "verdict") ?? incomplete[0];
  process.exit(reportCheckFailure(failure, process.env, completedFailures));
}
if (failures.length === 0 && runScratch) rmSync(runScratch, { recursive: true, force: true });
else if (runScratch) console.log(`  kept axis artifacts: ${runScratch}`);
process.exit(failures.length === 0 ? 0 : 1);
