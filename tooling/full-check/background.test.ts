import {fixtureEnvironment} from "../gate/test-environment.ts";
// node --test tooling/full-check/background.test.ts
//
// The full check's background work: a job's outcome, written whole and read
// once its unit is gone; the rule a restarted controller follows by the
// unit's name (running, ended, gone without an outcome and started once more);
// and the same against real units of the user manager, each in this tooling
// run's slice, stopped by its name.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { gateCpus, inheritedCpus } from "../gate/affinity.ts";
import { waitFor } from "../gate/test-wait.ts";
import { toolingSlice } from "../gate/tooling-slice.ts";
import { look, newJob, readOutcome, start, startAgain, STARTS, systemdUnits, writeOutcome, type Units, type UnitSpec } from "./background.ts";
import { stubUnits } from "./repository-fixture.ts";
import { lowPriority } from "./unit.ts";

function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "full-check-background-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const AT = new Date("2026-11-09T20:00:00.000Z"), LATER = new Date("2026-11-09T21:00:00.000Z");

test("an outcome is written whole, with its version and time, and read back; a missing one is none, a damaged one is an error", t => {
  const dir = scratch(t), file = join(dir, "work/outcome.json");
  assert.equal(readOutcome(file), null);
  writeOutcome(file, { status: 3, files: ["results/a.tsv"] }, AT);
  assert.deepEqual(readOutcome<{ files: string[] }>(file), { version: 1, at: AT.toISOString(), status: 3, files: ["results/a.tsv"] });
  assert.deepEqual(readdirSync(join(dir, "work")), ["outcome.json"], "nothing half written is left beside it");
  writeFileSync(file, JSON.stringify({ status: 0 }));
  assert.throws(() => readOutcome(file), /not an outcome of version 1/);
});

test("a job is saved before its unit starts, with the outcome of an earlier start gone, and a start that fails says why", t => {
  const dir = scratch(t), units = stubUnits(), outcome = join(dir, "outcome.json");
  const spec: UnitSpec = { name: "nts-test-work", cwd: dir, command: ["true"], log: join(dir, "log") };
  writeOutcome(outcome, { status: 0 }, AT);
  const job = newJob(spec.name, outcome, AT), seen: string[] = [];
  const save = () => seen.push(`saved: ${units.running(spec.name) ? "running" : "not running"}, outcome ${existsSync(outcome) ? "there" : "gone"}`);
  assert.equal(start(units, spec, job, save), null);
  assert.deepEqual(seen, ["saved: not running, outcome gone"], "saved before the unit exists, and after the earlier outcome went");
  assert.match(start(units, spec, job, save) ?? "", /already loaded/, "a second unit of the name does not start while one runs");
  assert.throws(() => start(units, { ...spec, name: "another" }, job, save), /the job is nts-test-work's, not another's/);
  const failing: Units = { start: () => { throw new Error("no user manager"); }, running: () => false };
  assert.equal(start(failing, spec, job, () => {}), "no user manager");
});

test("a job is running while its unit is; ended once its unit is gone with an outcome; lost when gone without one, and started once more, never a third time", t => {
  const dir = scratch(t), units = stubUnits(), outcome = join(dir, "outcome.json");
  const spec: UnitSpec = { name: "nts-test-work", cwd: dir, command: ["true"], log: join(dir, "log") };
  const job = newJob(spec.name, outcome, AT);
  start(units, spec, job, () => {});
  assert.deepEqual(look(job, units, LATER), { state: "running" });
  // Stopped, killed, or the machine restarted: gone, and nothing written.
  units.stop(spec.name);
  assert.deepEqual(look(job, units, LATER), { state: "lost", why: "nts-test-work is gone and wrote no outcome", again: true });
  assert.equal(startAgain(units, spec, job, LATER, () => {}), null);
  assert.deepEqual([job.starts, job.at], [2, LATER.toISOString()]);
  units.stop(spec.name);
  assert.deepEqual(look(job, units, LATER), { state: "lost", why: "nts-test-work is gone and wrote no outcome", again: false });
  assert.throws(() => startAgain(units, spec, job, LATER, () => {}), new RegExp(`started ${STARTS} times already`));
  // Started again by hand after all, it ends and writes its outcome: it ended, and when it was read is kept.
  units.start(spec);
  units.finish(spec.name, () => writeOutcome(outcome, { status: 0, kept: true }, LATER));
  assert.deepEqual(look<{ kept: boolean }>(job, units, LATER), { state: "ended", outcome: { version: 1, at: LATER.toISOString(), status: 0, kept: true } });
  assert.equal(job.ended, LATER.toISOString());
});

test("an outcome that cannot be read is lost, and not started again: the work ended, and running it again would not tell how", t => {
  const dir = scratch(t), units = stubUnits(), outcome = join(dir, "outcome.json");
  const job = newJob("nts-test-work", outcome, AT);
  writeFileSync(outcome, "{ half");
  const seen = look(job, units, LATER);
  assert.equal(seen.state, "lost");
  if (seen.state !== "lost") return;
  assert.equal(seen.again, false);
  assert.match(seen.why, /^its outcome cannot be read: /);
});

/** A unit of the user manager this test owns: its name is unique, and it is stopped by that name when the test ends. */
function ownedUnit(t: TestContext, what: string): string {
  const name = `nts-test-background-${what}-${randomUUID().slice(0, 8)}`;
  t.after(() => { spawnSync("systemctl", ["--user", "stop", `${name}.service`], {env:fixtureEnvironment(t), stdio: "ignore" }); });
  return name;
}

test("a real unit runs its command in its tree, at low priority off the measurement CPUs, its output in its log, and is read once it ends", async t => {
  const dir = scratch(t), tree = join(dir, "tree"), units = systemdUnits(lowPriority(gateCpus(inheritedCpus())));
  mkdirSync(tree);
  const name = ownedUnit(t, "ends"), outcome = join(dir, "outcome.json"), log = join(dir, "unit.log");
  // The work says where and how it runs, then writes its outcome as its last act.
  const work = `const {readFileSync,writeFileSync,renameSync}=require("node:fs"),os=require("node:os");`
    + `const cpus=/^Cpus_allowed_list:\\s*(\\S+)/m.exec(readFileSync("/proc/self/status","utf8"))[1];`
    + `console.log(JSON.stringify({cwd:process.cwd(),nice:os.getPriority(),cpus,cgroup:readFileSync("/proc/self/cgroup","utf8").trim()}));`
    + `writeFileSync(process.argv[1]+".partial",JSON.stringify({version:1,at:new Date(0).toISOString(),status:0,said:"done"}));renameSync(process.argv[1]+".partial",process.argv[1]);`;
  const job = newJob(name, outcome, AT);
  assert.equal(start(units, { name, cwd: tree, command: [process.execPath, "-e", work, outcome], log }, job, () => {}), null);
  await waitFor(`${name} to end`, () => !units.running(name));
  const seen = look<{ said: string }>(job, units, LATER);
  assert.equal(seen.state, "ended", JSON.stringify(seen));
  if (seen.state !== "ended") return;
  assert.equal(seen.outcome.said, "done");
  const { cgroup, ...said } = JSON.parse(readFileSync(log, "utf8").trim().split("\n")[0]!) as { cgroup: string };
  assert.deepEqual(said, { cwd: tree, nice: 19, cpus: gateCpus(inheritedCpus()) });
  // Inside a tooling run, the run's slice holds it, and stops it with the run.
  const slice = toolingSlice();
  assert.ok(cgroup.endsWith(slice ? `/${slice}/${name}.service` : `/${name}.service`), cgroup);
});

test("a real unit that runs on is running, refuses a second of its name, and once stopped by its name is lost without an outcome", async t => {
  const dir = scratch(t), units = systemdUnits(lowPriority(gateCpus(inheritedCpus())));
  const name = ownedUnit(t, "runs"), outcome = join(dir, "outcome.json");
  const spec: UnitSpec = { name, cwd: dir, command: ["tail", "-f", "/dev/null"], log: join(dir, "unit.log") };
  const job = newJob(name, outcome, AT);
  assert.equal(start(units, spec, job, () => {}), null);
  assert.equal(units.running(name), true);
  assert.deepEqual(look(job, units, LATER), { state: "running" });
  assert.match(start(units, spec, job, () => {}) ?? "", /systemd-run exited 1/, "never a second unit of one name");
  assert.equal(spawnSync("systemctl", ["--user", "stop", `${name}.service`], {env:fixtureEnvironment(t)}).status, 0);
  await waitFor(`${name} to be gone`, () => !units.running(name));
  assert.deepEqual(look(job, units, LATER), { state: "lost", why: `${name} is gone and wrote no outcome`, again: true });
  assert.equal(units.running(`nts-test-background-never-${randomUUID().slice(0, 8)}`), false, "a name no unit has is not running");
});

test("a real unit's own properties reach it: past its hang guard it is stopped, gone with no outcome, and not measured", async t => {
  const dir = scratch(t), units = systemdUnits(lowPriority(gateCpus(inheritedCpus())));
  const name = ownedUnit(t, "guard"), outcome = join(dir, "outcome.json");
  const job = newJob(name, outcome, AT);
  assert.equal(start(units, { name, cwd: dir, command: ["tail", "-f", "/dev/null"], log: join(dir, "unit.log"), properties: ["RuntimeMaxSec=1"] }, job, () => {}), null);
  await waitFor(`${name} to be stopped at its hang guard`, () => !units.running(name));
  assert.deepEqual(look(job, units, LATER), { state: "lost", why: `${name} is gone and wrote no outcome`, again: true });
});
