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

import { spawnSync } from "node:child_process";
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAxis } from "./compiled-axis-rows.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const TABLE = join(HERE, "compiled-axis.floor");
const argv = process.argv.slice(2);
const recording = argv.includes("--record");
const from = argv.includes("--from") ? argv[argv.indexOf("--from") + 1] : null;

// **Seen to read every shape before it is trusted**, on the lines the script prints.
function selfTest() {
  const sample = [
    "stream                 271 file(s): 1 passed, 251 failed, 4 skipped, 15 not applicable",
    "fs                   3 real, 1 hollow, 347 failed",
    "timers               PUBLISHES NOTHING -- 2 real pass(es), 0 that survive emptying",
    "process              WILL NOT LOAD -- undefined symbol: module__init",
    "",
    "TOTAL                48 passed, 1717 failed, 4 hollow (not counted)",
  ].join("\n");
  const r = readAxis(sample);
  if (r.get("stream")?.real !== 1 || r.get("fs")?.real !== 3 || r.get("timers")?.real !== 2) return `a row was misread: ${JSON.stringify([...r])}`;
  if (!r.get("process")?.unmeasured) return "a module that will not load was read as measured";
  if (r.has("TOTAL")) return "the total was read as a module";
  return null;
}
const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (argv.includes("--self-test")) {
  console.log("  self-test: all four row shapes read, a module that will not load not measured, the total not a module");
  process.exit(0);
}

/** Run compiled-axis.sh pinned and isolated, returning its output. */
function runAxis() {
  const source = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
  if (!existsSync(source)) {
    console.log(`  NOT MEASURED: no compiler at ${source}; set NTS_BIN`);
    process.exit(2);
  }
  const base = join(homedir(), ".cache/nts-compiled-axis");
  mkdirSync(base, { recursive: true });
  const scratch = mkdtempSync(join(base, "run-"));
  process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
  // Pinned: a peer relinking target/release/nts mid-run rebuilds half the
  // modules with another compiler. Every cache and temporary file private:
  // the default snapshot cache is shared by every lane on the box.
  const nts = join(scratch, "nts");
  copyFileSync(source, nts);
  chmodSync(nts, 0o755);
  for (const d of ["addons", "snapshots", "tmp"]) mkdirSync(join(scratch, d));
  console.log(`  running compiled-axis.sh against ${source} (pinned); about 16 minutes`);
  const run = spawnSync("bash", [join(HERE, "compiled-axis.sh")], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 26,
    env: {
      ...process.env,
      NTS_BIN: nts,
      NTS_TSGO: process.env.NTS_TSGO ?? join(ROOT, "target/tsgo"),
      NTS_ADDON_OUT: join(scratch, "addons"),
      NTS_SNAPSHOT_CACHE: join(scratch, "snapshots"),
      TMPDIR: join(scratch, "tmp"),
    },
  });
  return `${run.stdout ?? ""}${run.stderr ?? ""}`;
}

const text = from ? readFileSync(from, "utf8") : runAxis();
const axis = readAxis(text);
if (axis.size === 0) {
  console.log("  NOT MEASURED: the run printed no module rows");
  process.exit(1);
}

if (recording) {
  const unmeasured = [...axis].filter(([, r]) => r.unmeasured);
  if (unmeasured.length > 0) {
    console.log(`  not recorded: ${unmeasured.map(([m]) => m).join(", ")} did not load`);
    process.exit(1);
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
  process.exit(0);
}

if (!existsSync(TABLE)) {
  console.log("  NOT MEASURED: no tooling/conformance/compiled-axis.floor; run with --record first");
  process.exit(1);
}
const table = new Map(
  readFileSync(TABLE, "utf8").split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => l.trim().split(/\s+/)).map(([m, n]) => [m, Number(n)]),
);
const failures = [];
const notes = [];
for (const [module, was] of table) {
  const now = axis.get(module);
  if (!now) failures.push(`${module}: in the table, not in the run`);
  else if (now.unmeasured) failures.push(`${module}: ${now.unmeasured}`);
  else if (now.real < was) failures.push(`${module}: ${was} -> ${now.real} real pass(es), ${now.real - was}${now.publishesNothing ? " -- and it publishes nothing" : ""}`);
  else if (now.real > was) notes.push(`${module}: ${was} -> ${now.real}, +${now.real - was} -- newly passing; raise the row once each is known to belong`);
}
for (const [module] of axis) if (!table.has(module)) failures.push(`${module}: in the run, no row in the table -- add one`);
const total = [...axis.values()].reduce((a, r) => a + (r.real ?? 0), 0);
console.log(`  ${axis.size} module(s), ${total} real pass(es)`);
for (const n of notes) console.log(`  up        ${n}`);
for (const f of failures) console.log(`  DOWN      ${f}`);
console.log(failures.length === 0 ? "  no module passes fewer of node's tests than its row" : `  ${failures.length} failure(s)`);
process.exit(failures.length === 0 ? 0 : 1);
