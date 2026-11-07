// Running a landing's steps: the build first, the rest through the gate's own
// runner, memory pressure retried, pending lines collected.
//
//   node --test tooling/landing/run.test.ts
//
// The tree is a fixture whose tooling/gate holds the real run.mjs and step
// table beside a stand-in all.sh: each step does what a file in the fixture's
// controls says (pass, fail, pressure once, pending lines). The gate's
// environment drops a launcher's variables, so the controls are files. The
// fixture has its own HOME, so the runner's binary pins stay in it.
import {test, type TestContext} from "node:test";
import assert from "node:assert/strict";
import {execFileSync,spawnSync} from "node:child_process";
import {chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join, dirname, resolve} from "node:path";

import {fileURLToPath} from "node:url";
import {ENVIRONMENT_CONTEXT, ENVIRONMENT_EXPERIMENT, gateEnvironment, sealOracleRun} from "../gate/canonical-environment.ts";
import {oracleWorkspaceFixture} from "../differential/oracle-workspace-fixture.ts";
import {moduleClosure} from "../gate/module-closure-fixture.ts";
import {launcherEnvironment, PROFILE, pendingLines, removeRun, runLanding, type RunOptions} from "./run.ts";
import {newTestScratch} from "../gate/test-scratch.ts";

const GATE = fileURLToPath(new URL("../gate/", import.meta.url));

function fixture(t: TestContext) {
  // A red run keeps read-only captured inputs in its temporary directory: removeRun restores them first.
  const own = newTestScratch("landing-run"); t.after(() => removeRun(own));
  const tree = join(own, "tree"), gate = join(tree, "tooling/gate"), controls = join(own, "controls"), home = join(own, "home");
  const target = join(home, ".cache/target"), run = join(home, ".cache/runs/one");
  for (const dir of [gate, controls, target]) mkdirSync(dir, { recursive: true });
  for (const name of moduleClosure(["tooling/gate/run.mjs"])) {
    const target = join(tree, name), original = join(GATE, "../..", name);
    mkdirSync(dirname(target), {recursive: true});
    if (name === "tooling/gate/run.mjs") writeFileSync(target, readFileSync(original));
    else symlinkSync(original, target);
  }
  oracleWorkspaceFixture(t,tree);
  symlinkSync(join(GATE, "times.tsv"), join(gate, "times.tsv"));
  const names = execFileSync("sh", [join(GATE, "all.sh"), "--list"], { encoding: "utf8" }).trim();
  writeFileSync(join(gate, "all.sh"), `#!/bin/sh
controls=${JSON.stringify(controls)}
if [ "$1" = --list ]; then
cat <<'NAMES'
${names}
NAMES
exit 0
fi
if [ "$1" = --call ]; then
  step=$2
  control=$(cat "$controls/$step" 2>/dev/null || echo pass)
  instrument() { printf '{"version":1,"verdict":"%s","kind":"%s","step":"%s","attempt":"%s","reason":"%s"}\\n' "$1" "$2" "$step" "$NTS_GATE_STEP_ATTEMPT" "$3" > "$NTS_GATE_STEP_RESULT"; exit 75; }
  if [ "$step" = program-oracles ]; then
    node --input-type=module -e 'import {createProgramOracleResults} from ${JSON.stringify(new URL("../differential/oracle-results.ts",import.meta.url).href)};import {programOracleDirectory} from ${JSON.stringify(new URL("../differential/oracle-result-scope.ts",import.meta.url).href)};import {oracleRecipeIdentity} from ${JSON.stringify(new URL("../differential/oracle-emit.ts",import.meta.url).href)};import {join} from "node:path";createProgramOracleResults(join(programOracleDirectory(),"results"),oracleRecipeIdentity()).publish();' || exit $?
  fi
  echo "$step $NTS_TEST_PROFILE $NTS_BIN $CARGO_INCREMENTAL" >> "$controls/calls"
  [ "$step" = doctests ] && echo "$NTS_DOCTEST_CRATES" > "$controls/doctest-crates"
  case $control in
    pass) echo "  $step: every case as recorded"; exit 0 ;;
    oracle-context) node --input-type=module -e 'import {readFileSync,writeFileSync} from "node:fs";import {createHash} from "node:crypto";const capture=JSON.parse(process.env.NTS_ORACLE_DEPENDENCIES),parent=readFileSync(${JSON.stringify(join(controls,"parent-record"))},"utf8");writeFileSync(${JSON.stringify(join(controls,"oracle-context.json"))},JSON.stringify({capture,imageSource:JSON.parse(readFileSync(capture.seal.record,"utf8")).source,parentSha256:createHash("sha256").update(readFileSync(parent)).digest("hex"),temporary:JSON.parse(process.env[${JSON.stringify(ENVIRONMENT_CONTEXT)}]).temporary}));'; exit $? ;;
    fail) echo "  $step: a recorded case went wrong"; exit 1 ;;
    pending) echo "  pending: tests/x/a.ts is not recorded in results/x.tsv yet"; echo "  improved, record pending: tests/x/b.ts refused -> pass"; exit 0 ;;
    pressure) [ -e "$controls/$step.pressured" ] && exit 0; : > "$controls/$step.pressured"; instrument INSTRUMENT memory-pressure "memory: 9.0 GB available" ;;
    always-pressure) instrument INSTRUMENT memory-pressure "memory: 9.0 GB available" ;;
    hung) instrument "NOT RUN" hung "no progress for 600 s" ;;
    stuck) echo "  $step: waits for ever"; exec tail -f /dev/null ;;
  esac
fi
exec node "$(dirname "$0")/run.mjs" "$@"
`);
  chmodSync(join(gate, "all.sh"), 0o755);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: tree, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: "a@a", GIT_COMMITTER_NAME: "a", GIT_COMMITTER_EMAIL: "a@a" } }).trim();
  const commit = git("rev-parse", "HEAD");
  const meminfo = join(own, "meminfo"); writeFileSync(meminfo, "MemAvailable: 64000000 kB\n");
  const build = join(own, "build.sh");
  writeFileSync(build, `#!/bin/sh\n[ "$(cat ${JSON.stringify(join(controls, "build"))} 2>/dev/null)" = fail ] && { echo "error[E0308]: mismatched types"; exit 101; }\nmkdir -p "$CARGO_TARGET_DIR/${PROFILE}" && echo "nts $CARGO_INCREMENTAL" > "$CARGO_TARGET_DIR/${PROFILE}/nts" && chmod +x "$CARGO_TARGET_DIR/${PROFILE}/nts"\necho "   Compiling nts-core"\n`);
  chmodSync(build, 0o755);
  const control = (step: string, what: string) => writeFileSync(join(controls, step), what);
  const options = (steps: string[], extra: Partial<RunOptions> = {}): RunOptions => ({
    tree, target, run, commit, steps, build: [build], env: { ...process.env, HOME: home }, memory: () => 64, pause: () => {},
    owned: { NTS_GATE_SLOTS: "4", NTS_GATE_MEM_GB: "8", NTS_MEMINFO: meminfo }, ...extra,
  });
  return { tree, target, run, controls, control, options, calls: () => { try { return readFileSync(join(controls, "calls"), "utf8").trim().split("\n"); } catch { return []; } } };
}

test("a candidate gate replaces old main's foreign oracle handoff but holds its own changed seal",async t=>{
  for(const foreign of [true,false])await t.test(foreign?"foreign root gets a fresh capture":"same-root corruption holds",async()=>{
    const f=fixture(t),options=f.options(["rustfmt"]);f.control("rustfmt","oracle-context");
    const launcher=launcherEnvironment(options.env);
    const planned=gateEnvironment(launcher,{run:f.run,owned:{...options.owned,NTS_GATE_STEPS:"rustfmt"},oracleAdmissionContext:"gate",
      ...(!foreign?{oracleRoot:f.tree}:{})});
    const parent=await sealOracleRun(planned),before=JSON.parse(parent.env.NTS_ORACLE_DEPENDENCIES!) as {source:string;directory:string;admission:unknown;seal:{record:string}};
    assert.equal(before.source,foreign?resolve(GATE,"../.."):f.tree);
    const original=readFileSync(before.seal.record);
    writeFileSync(join(f.controls,"parent-record"),before.seal.record);
    if(!foreign){chmodSync(before.seal.record,0o644);writeFileSync(before.seal.record,Buffer.concat([original,Buffer.from(" ")]));chmodSync(before.seal.record,0o444);}
    const child=spawnSync(process.execPath,[join(f.tree,"tooling/gate/run.mjs")],{cwd:f.tree,env:parent.env,encoding:"utf8",maxBuffer:16*1024**2});
    if(foreign){
      assert.equal(child.status,0,child.stdout+child.stderr);
      const observed=JSON.parse(readFileSync(join(f.controls,"oracle-context.json"),"utf8")) as {capture:typeof before;imageSource:string;parentSha256:string;temporary:unknown};
      const after=observed.capture;
      assert.equal(after.source,f.tree);assert.notEqual(after.directory,before.directory);assert.notEqual(after.seal.record,before.seal.record);
      assert.deepEqual(after.admission,before.admission);
      assert.equal(observed.parentSha256,createHash("sha256").update(original).digest("hex"),"the unused parent capture remains intact until cleanup");
      assert.equal(observed.imageSource,f.tree);assert.deepEqual(observed.temporary,parent.temporary);
    }else{
      assert.notEqual(child.status,0,child.stdout+child.stderr);
      assert.match(child.stdout+child.stderr,/oracle dependency.*(?:changed|identity|seal)/);
      assert.equal(existsSync(join(f.controls,"oracle-context.json")),false,"a corrupt owned seal grants no execution");
      assert.deepEqual(readFileSync(before.seal.record),Buffer.concat([original,Buffer.from(" ")]),"no replacement hides the corruption");
    }
  });
});

test("the compiler builds first in nts-dev, and the steps drive it through the gate's own runner", t => {
  const f = fixture(t);
  const ran = runLanding(f.options(["build", "examples", "outcomes", "rustfmt"]));
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
  assert.ok(existsSync(join(f.run, "landing.json")));
});

test("a step the rules narrowed runs narrowed: the touched crates' doc tests", t => {
  const f = fixture(t);
  const ran = runLanding(f.options(["build", "doctests"], { doctests: "nts-core nts-cli" }));
  assert.equal(ran.state, "green", ran.message);
  assert.equal(readFileSync(join(f.controls, "doctest-crates"), "utf8"), "nts-core nts-cli\n");
});

test("a failing build refuses the change, and nothing after it runs", t => {
  const f = fixture(t);
  f.control("build", "fail");
  const ran = runLanding(f.options(["build", "examples"]));
  assert.equal(ran.state, "red");
  assert.match(ran.message, /^build FAIL; log .*build\.log$/);
  assert.deepEqual(ran.steps.map(s => `${s.name} ${s.verdict}`), ["build FAIL", "examples NOT RUN"]);
  assert.match(readFileSync(ran.steps[0]!.log!, "utf8"), /mismatched types/);
  assert.deepEqual(f.calls(), []);
});

test("a failing step refuses the change and names itself", t => {
  const f = fixture(t);
  f.control("outcomes", "fail");
  const ran = runLanding(f.options(["build", "examples", "outcomes"]));
  assert.equal(ran.state, "red");
  assert.match(ran.message, /^outcomes FAIL; logs /);
  assert.equal(ran.steps.find(s => s.name === "examples")?.verdict, "PASS");
});

test("a landing run started inside another gate is a run of its own, not that gate's", t => {
  // The tooling step of a train of three: its context owns the train's red-stop.
  const f = fixture(t), home = f.options([]).env!.HOME!;
  const outer = gateEnvironment({ ...process.env, HOME: home }, { run: join(home, ".cache/outer-train"), owned: { NTS_GATE_TRAIN_MEMBERS: "3", NTS_GATE_STEPS: "tooling" } }).env;
  assert.ok(outer[ENVIRONMENT_CONTEXT]);
  f.control("outcomes", "fail");
  const ran = runLanding(f.options(["build", "examples", "outcomes"], { env: { ...outer, HOME: home } }));
  assert.equal(ran.state, "red");
  assert.equal(ran.steps.find(s => s.name === "examples")?.verdict, "PASS", "the train's red-stop did not reach this run");
  const summary = JSON.parse(readFileSync(join(f.run, "summary.json"), "utf8"));
  assert.equal(summary.train_red_stop, undefined);
  assert.deepEqual(launcherEnvironment({ A: "1", [ENVIRONMENT_CONTEXT]: "{}", [ENVIRONMENT_EXPERIMENT]: "today" }), { A: "1" });
});

test("a step memory pressure kept from measuring runs again once memory allows, alone", t => {
  const f = fixture(t);
  f.control("examples", "pressure");
  const holds: string[] = [];
  let memory = 64, reads = 0;
  const ran = runLanding(f.options(["build", "examples", "outcomes"], {
    hold: reason => holds.push(reason),
    memory: () => { reads++; return memory; },
    pause: () => { memory = 64; },
  }));
  assert.equal(ran.state, "green", ran.message);
  assert.equal(ran.steps.find(s => s.name === "examples")?.attempt, 2);
  assert.ok(holds.some(h => /memory pressure kept examples from measuring/.test(h)), holds.join("\n"));
  assert.ok(existsSync(join(f.run, "attempt-2/summary.json")));
  const attempt = JSON.parse(readFileSync(join(f.run, "attempt-2/summary.json"), "utf8"));
  assert.deepEqual(attempt.requested, ["program-oracles", "examples"], "only the unmeasured native step and its run-owned producer run again");
  assert.ok(reads >= 2);
});

test("memory the run waits for is a hold, never a verdict", t => {
  const f = fixture(t);
  const holds: string[] = [];
  let memory = 9;
  const ran = runLanding(f.options(["build", "outcomes"], { hold: reason => holds.push(reason), memory: () => memory, pause: () => { memory = 20; } }));
  assert.equal(ran.state, "green");
  assert.match(holds[0] ?? "", /memory: 9\.0 GB available, waiting for 14 GB before the build/);
  // A docs-only landing runs only tree checks and waits for nothing.
  const light = fixture(t);
  const tree = runLanding(light.options(["rustfmt", "records"], { build: undefined, memory: () => 1, pause: () => { throw new Error("waited"); } }));
  assert.equal(tree.state, "green", tree.message);
});

test("pressure that never clears, and a hung step, hold the change for a person", t => {
  const f = fixture(t);
  f.control("examples", "always-pressure");
  const pressed = runLanding(f.options(["build", "examples"], { attempts: 2 }));
  assert.equal(pressed.state, "held");
  assert.match(pressed.message, /examples INSTRUMENT/);
  const g = fixture(t);
  g.control("outcomes", "hung");
  const hung = runLanding(g.options(["build", "outcomes"]));
  assert.equal(hung.state, "held");
  assert.match(hung.message, /outcomes NOT RUN: no progress for 600 s/);
});

test("the landing check's ceiling reaches the runner: a stuck step is stopped there and holds the change", t => {
  const f = fixture(t);
  f.control("outcomes", "stuck");
  const ran = runLanding(f.options(["build", "outcomes", "rustfmt"], { ceiling: 2 }));
  assert.equal(ran.state, "held", ran.message);
  assert.match(ran.message, /outcomes INSTRUMENT: step exceeded its bound of 2 s/);
  assert.deepEqual(ran.steps.map(s => `${s.name} ${s.verdict}`), ["build PASS", "outcomes INSTRUMENT", "rustfmt PASS"]);
});

test("a tree whose gate cannot say what its steps need holds the change", t => {
  const f = fixture(t);
  writeFileSync(join(f.tree, "tooling/gate/run.mjs"), "throw new Error('a runner this change broke');\n");
  const ran = runLanding(f.options(["build", "outcomes"]));
  assert.equal(ran.state, "held");
  assert.match(ran.message, /could not say what its steps need: cannot read gate capabilities/);
});

test("pending and improved lines are listed as information, and pass", t => {
  const f = fixture(t);
  f.control("outcomes", "pending");
  const ran = runLanding(f.options(["build", "outcomes"]));
  assert.equal(ran.state, "green", ran.message);
  assert.deepEqual(ran.pending, ["pending: tests/x/a.ts is not recorded in results/x.tsv yet", "improved, record pending: tests/x/b.ts refused -> pass"]);
  assert.deepEqual(pendingLines(join(f.run, "nowhere")), []);
});
