import {fixtureEnvironment} from "../gate/test-environment.ts";
// A landing's steps (run.ts): the build first, the rest through the gate's own
// runner, narrowed steps, failing builds and steps, a run inside another gate,
// and memory pressure run again alone. Shared helpers are in run-fixture.ts.
import {test} from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {ENVIRONMENT_CONTEXT,ENVIRONMENT_EXPERIMENT,gateEnvironment} from "../gate/canonical-environment.ts";
import {launcherEnvironment,PROFILE,runLanding} from "./run.ts";
import {fixture} from './run-fixture.ts';

test("the compiler builds first in nts-dev, and the steps drive it through the gate's own runner", async t => {
  const f = fixture(t);
  const ran = await runLanding(f.options(["build", "examples", "outcomes", "rustfmt"]));
  assert.equal(ran.state, "green", ran.message);
  assert.deepEqual(ran.steps.map(s => `${s.name} ${s.verdict}`), ["build PASS", "examples PASS", "outcomes PASS", "rustfmt PASS"]);
  assert.ok(ran.steps[0]!.wall !== undefined, "the build is timed");
  assert.equal(readFileSync(join(f.target, PROFILE, "nts"), "utf8"), "nts 1\n", "built incrementally");
  // Every step builds in nts-dev and drives the compiler built: the runner's
  // pin of it by content, kept in the fixture's own cache, not the machine's.
  for (const line of f.calls()) {
    const [, profile, bin, incremental] = line.split(" ");
    assert.equal(profile, "nts-dev");
    assert.equal(incremental, "1");
    assert.ok(bin!.startsWith(join(f.target, "..", "nts-gate/bin/")), bin);
    assert.equal(readFileSync(bin!, "utf8"), "nts 1\n");
  }
  const summary = JSON.parse(readFileSync(join(f.run, "summary.json"), "utf8"));
  assert.deepEqual([...summary.requested].sort(), ["examples", "outcomes", "program-oracles", "rustfmt"], "the runner ran the landing steps and their required producer");
  assert.equal(summary.environment.canonical, true);
  assert.equal(summary.memory.priority, "landing", "the runner's reservation waits at the landing check's priority");
  assert.ok(existsSync(join(f.run, "landing.json")));
});

test("pinned binary identities survive a step relinking the original target", async t => {
  const f = fixture(t), script = join(f.tree, "tooling/gate/all.sh");
  const original = readFileSync(script, "utf8");
  assert.ok(original.includes("pass) echo"));
  writeFileSync(script, original.replace("pass) echo",
    `pass) printf changed > "$CARGO_TARGET_DIR/${PROFILE}/nts"; echo`));
  const ran = await runLanding(f.options(["build", "rustfmt"]));
  assert.equal(ran.state, "green", ran.message);
  const summary = JSON.parse(readFileSync(join(f.run, "summary.json"), "utf8"));
  const changed = createHash("sha256").update(readFileSync(join(f.target, PROFILE, "nts"))).digest("hex");
  assert.notEqual(summary.identities.nts.sha256, changed);
  assert.equal(ran.steps.find(step => step.name === "rustfmt")?.binaries?.nts, summary.identities.nts.sha256);
  assert.equal(ran.steps.find(step => step.name === "build")?.binaries?.nts, summary.identities.nts.sha256);
});

test("a step the rules narrowed runs narrowed: the touched crates' doc tests", async t => {
  const f = fixture(t);
  const ran = await runLanding(f.options(["build", "doctests"], { doctests: "nts-core nts-cli" }));
  assert.equal(ran.state, "green", ran.message);
  assert.equal(readFileSync(join(f.controls, "doctest-crates"), "utf8"), "nts-core nts-cli\n");
});

test("a failing build refuses the change, and nothing after it runs", async t => {
  const f = fixture(t);
  f.control("build", "fail");
  const ran = await runLanding(f.options(["build", "examples"]));
  assert.equal(ran.state, "red");
  assert.match(ran.message, /^build FAIL; log .*build\.log$/);
  assert.deepEqual(ran.steps.map(s => `${s.name} ${s.verdict}`), ["build FAIL", "examples NOT RUN"]);
  assert.match(readFileSync(ran.steps[0]!.log!, "utf8"), /mismatched types/);
  assert.deepEqual(f.calls(), []);
});

test("a failing step refuses the change and names itself", async t => {
  const f = fixture(t);
  f.control("outcomes", "fail");
  const ran = await runLanding(f.options(["build", "examples", "outcomes"]));
  assert.equal(ran.state, "red");
  assert.match(ran.message, /^outcomes FAIL; logs /);
  assert.equal(ran.steps.find(s => s.name === "examples")?.verdict, "PASS");
});

test("a landing run started inside another gate is a run of its own, not that gate's", async t => {
  // The tooling step of an outer gate: its context owns that gate's fail-fast.
  const f = fixture(t), home = f.options([]).env!.HOME!;
  const outer = gateEnvironment({ ...fixtureEnvironment(t), HOME: home }, { run: join(home, ".cache/outer-gate"), owned: { NTS_GATE_FAIL_FAST: "1", NTS_GATE_STEPS: "tooling" } }).env;
  assert.ok(outer[ENVIRONMENT_CONTEXT]);
  f.control("outcomes", "fail");
  const ran = await runLanding(f.options(["build", "examples", "outcomes"], { env: { ...outer, HOME: home } }));
  assert.equal(ran.state, "red");
  assert.equal(ran.steps.find(s => s.name === "examples")?.verdict, "PASS", "the outer gate's fail-fast did not reach this run");
  assert.deepEqual(launcherEnvironment({ A: "1", [ENVIRONMENT_CONTEXT]: "{}", [ENVIRONMENT_EXPERIMENT]: "today" }), { A: "1" });
});

test("a step memory pressure kept from measuring runs again, alone", async t => {
  const f = fixture(t);
  f.control("examples", "pressure");
  const holds: string[] = [];
  const ran = await runLanding(f.options(["build", "examples", "outcomes"], { hold: reason => holds.push(reason) }));
  assert.equal(ran.state, "green", ran.message);
  assert.equal(ran.steps.find(s => s.name === "examples")?.attempt, 2);
  assert.ok(holds.some(h => /memory pressure kept examples from measuring/.test(h)), holds.join("\n"));
  assert.ok(existsSync(join(f.run, "attempt-2/summary.json")));
  const attempt = JSON.parse(readFileSync(join(f.run, "attempt-2/summary.json"), "utf8"));
  assert.deepEqual(attempt.requested, ["program-oracles", "examples"], "only the unmeasured native step and its run-owned producer run again");
  assert.equal(attempt.memory.priority, "landing");
});
