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
import {chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join, dirname, resolve} from "node:path";

import {fileURLToPath} from "node:url";
import {ENVIRONMENT_CONTEXT, ENVIRONMENT_EXPERIMENT, gateEnvironment, hostEnvironment, sealOracleRun} from "../gate/canonical-environment.ts";
import {oracleWorkspaceFixture} from "../differential/oracle-workspace-fixture.ts";
import {moduleClosure} from "../gate/module-closure-fixture.ts";
import {launcherEnvironment, PROFILE, pendingLines, removeRun, runLanding, type RunOptions} from "./run.ts";
import {newTestScratch} from "../gate/test-scratch.ts";
import {nodeInstallation} from "../gate/toolchain-fixture.ts";
import {fullEnvironment} from "../census/full-plan.ts";
import {candidateCommand} from "./candidate-environment.ts";

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
  writeFileSync(join(tree,".tool-versions"),`nodejs ${process.versions.node}\n`);
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
  return { own, tree, target, run, controls, control, options, calls: () => { try { return readFileSync(join(controls, "calls"), "utf8").trim().split("\n"); } catch { return []; } } };
}

test("a landing launches the candidate's pinned Node and forwards it to the build and child commands",t=>{
  const f=fixture(t),pin="99.1.0",installations=join(f.own,"installed"),log=join(f.own,"node-launches.jsonl");
  const node=nodeInstallation(installations,pin,log);
  writeFileSync(join(f.tree,".tool-versions"),`nodejs ${pin}\n`);
  const ran=runLanding(f.options(["build","rustfmt"],{nodeInstallations:installations,
    build:["sh","-c",`node --version > "$CARGO_TARGET_DIR/build-node"; mkdir -p "$CARGO_TARGET_DIR/${PROFILE}"; printf '#!/bin/sh\\n' > "$NTS_BIN"; chmod +x "$NTS_BIN"`]}));
  assert.equal(ran.state,"green",ran.message);
  assert.equal(readFileSync(join(f.target,"build-node"),"utf8"),"v"+pin+"\n");
  const calls=readFileSync(log,"utf8").trim().split("\n").map(line=>JSON.parse(line) as string[]);
  assert.ok(calls.some(args=>args[0]===join(f.tree,"tooling/gate/run.mjs")),"the runner is launched through the selected absolute binary");
  const environment=JSON.parse(readFileSync(join(f.run,"summary.json"),"utf8")).environment;
  assert.equal(environment.host.PATH.split(":")[0],dirname(node));
});

test("missing and wrong-version candidate Node installations hold without a launcher fallback",async t=>{
  for(const present of [false,true])await t.test(present?"wrong version":"not installed",()=>{
    const f=fixture(t),pin="99.1.0",installations=join(f.own,"installed");
    writeFileSync(join(f.tree,".tool-versions"),`nodejs ${pin}\n`);
    if(present)nodeInstallation(installations,pin,join(f.own,"node-launches.jsonl"),"98.0.0");
    const ran=runLanding(f.options(["rustfmt"],{nodeInstallations:installations}));
    assert.equal(ran.state,"held");assert.match(ran.message,/pinned Node 99\.1\.0/);
    assert.match(ran.message,/asdf install nodejs 99\.1\.0/);assert.deepEqual(f.calls(),[]);
  });
});

test("the candidate creates its build and gate environment with its own changed producer",t=>{
  const f=fixture(t),canonical=join(f.tree,'tooling/gate/canonical-environment.ts'),producer=join(f.tree,'tooling/differential/oracle-dependencies.ts');
  for(const file of [canonical,producer]){const bytes=readFileSync(file);unlinkSync(file);writeFileSync(file,bytes);}
  copyFileSync(join(GATE,'../differential/oracle-toolchain.json'),join(f.tree,'tooling/differential/oracle-toolchain.json'));
  writeFileSync(producer,readFileSync(producer,'utf8')+'\n// This candidate owns a different provisioner.\n');
  const expected=createHash('sha256').update(readFileSync(producer)).digest('hex');
  const options=f.options(['build','rustfmt'],{build:[process.execPath,'--input-type=module','-e',`import {mkdirSync,writeFileSync} from 'node:fs';import {dirname} from 'node:path';writeFileSync(${JSON.stringify(join(f.controls,'build-capture'))},process.env.NTS_ORACLE_DEPENDENCIES);mkdirSync(dirname(process.env.NTS_BIN),{recursive:true});writeFileSync(process.env.NTS_BIN,'#!/bin/sh\\n',{mode:0o755});`]});
  // A controller-owned same-root grant cannot be verified by this producer.
  const wrong=gateEnvironment(launcherEnvironment(options.env),{run:f.run,owned:options.owned,oracleRoot:f.tree});
  const before=spawnSync(process.execPath,[join(f.tree,'tooling/gate/run.mjs')],{cwd:f.tree,env:{...wrong.env,NTS_GATE_STEPS:'rustfmt'},encoding:'utf8'});
  assert.notEqual(before.status,0);assert.match(before.stdout+before.stderr,/oracle dependency provisioner source mismatch/);
  assert.equal(JSON.parse(readFileSync(join(f.run,'summary.json'),'utf8')).steps[0].verdict,'INSTRUMENT');
  const ran=runLanding(options);assert.equal(ran.state,'green',ran.message);
  assert.equal(JSON.parse(readFileSync(join(f.controls,'build-capture'),'utf8')).helperSha256,expected);
  const summary=JSON.parse(readFileSync(join(f.run,'summary.json'),'utf8'));
  assert.equal(JSON.parse(summary.environment.host.NTS_ORACLE_DEPENDENCIES).helperSha256,expected);
  assert.equal(summary.environment.canonical,true);
  // The full check's controller-root grant is foreign. The measured runner
  // already captures with its own producer after pinned.sh changes trees.
  const full=join(f.own,'home/.cache/full'),env=fullEnvironment({candidate:false,commit:options.commit,label:'MAIN',run:full,tree:f.tree,target:f.target},['rustfmt'],hostEnvironment(options.env!));
  const fullOwned=gateEnvironment(env,{run:full,owned:{NTS_MEMINFO:options.owned!.NTS_MEMINFO!}}).env;
  const measured=spawnSync(process.execPath,[join(f.tree,'tooling/gate/run.mjs')],{cwd:f.tree,env:fullOwned,encoding:'utf8'});
  assert.equal(measured.status,0,measured.stdout+measured.stderr);
  const observed=JSON.parse(readFileSync(join(full,'summary.json'),'utf8'));
  assert.equal(JSON.parse(observed.environment.host.NTS_ORACLE_DEPENDENCIES).helperSha256,expected);
  assert.equal(observed.environment.canonical,true);
});

test("a candidate missing the gateEnvironment contract is refused by name without executing its build",t=>{
  const f=fixture(t),file=join(f.tree,'tooling/gate/canonical-environment.ts');unlinkSync(file);writeFileSync(file,'export const legacy=true;\n');
  const ran=runLanding(f.options(['build'],{build:['sh','-c',`echo forbidden > ${JSON.stringify(join(f.controls,'built'))}`]}));
  assert.equal(ran.state,'red');assert.equal(existsSync(join(f.controls,'built')),false);
  assert.match(readFileSync(ran.steps[0]!.log!,'utf8'),/candidate environment contract: .*canonical-environment.ts must export gateEnvironment/);
});

test('an exception creating the candidate environment holds the landing instead of failing its build',t=>{
  const f=fixture(t),file=join(f.tree,'tooling/gate/canonical-environment.ts');unlinkSync(file);
  writeFileSync(file,"export function gateEnvironment(){throw Error('candidate environment setup control');}\n");
  const ran=runLanding(f.options(['build'],{build:['sh','-c',`echo forbidden > ${JSON.stringify(join(f.controls,'built'))}`],attempts:1}));
  assert.equal(ran.state,'held');assert.equal(ran.steps[0]!.verdict,'INSTRUMENT');
  assert.match(ran.steps[0]!.reason!,/candidate environment setup control/);
  assert.equal(existsSync(join(f.controls,'built')),false);
});

test("the candidate environment launcher preserves killed and unstarted build observations",t=>{
  for(const command of [['sh','-c','kill -TERM $$'],['/no-such-nts-build-command']]){
    const f=fixture(t),options=f.options([]),result=candidateCommand(process.execPath,{tree:f.tree,run:f.run,owned:options.owned!,command},launcherEnvironment(options.env));
    if(command[0]==='sh')assert.equal(result.signal,'SIGTERM');
    else assert.match(result.error!.message,/ENOENT/);
  }
});

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
    const child=candidateCommand(process.execPath,{tree:f.tree,run:f.run,owned:{},command:[process.execPath,join(f.tree,"tooling/gate/run.mjs")]},parent.env);
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

test('the candidate launcher refuses a malformed inherited oracle grant before executing a command',t=>{
  const f=fixture(t),options=f.options(['rustfmt']),planned=gateEnvironment(options.env!,{run:f.run,owned:options.owned,oracleRoot:f.tree});
  const context=JSON.parse(planned.env[ENVIRONMENT_CONTEXT]!),cap=JSON.parse(planned.env.NTS_ORACLE_DEPENDENCIES!);cap.version=0;
  const raw=JSON.stringify(cap);context.owned.NTS_ORACLE_DEPENDENCIES=raw;context.report.host.NTS_ORACLE_DEPENDENCIES=raw;
  const child=candidateCommand(process.execPath,{tree:f.tree,run:f.run,owned:{},command:['sh','-c',`echo forbidden > ${JSON.stringify(join(f.controls,'launched'))}`]},
    {...planned.env,NTS_ORACLE_DEPENDENCIES:raw,[ENVIRONMENT_CONTEXT]:JSON.stringify(context)});
  assert.equal(child.status,2);assert.match(child.stderr,/invalid owned oracle dependency handoff/);
  assert.match(child.error!.message,/invalid owned oracle dependency handoff/);
  assert.equal(existsSync(join(f.controls,'launched')),false);
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
  // The tooling step of an outer gate: its context owns that gate's fail-fast.
  const f = fixture(t), home = f.options([]).env!.HOME!;
  const outer = gateEnvironment({ ...process.env, HOME: home }, { run: join(home, ".cache/outer-gate"), owned: { NTS_GATE_FAIL_FAST: "1", NTS_GATE_STEPS: "tooling" } }).env;
  assert.ok(outer[ENVIRONMENT_CONTEXT]);
  f.control("outcomes", "fail");
  const ran = runLanding(f.options(["build", "examples", "outcomes"], { env: { ...outer, HOME: home } }));
  assert.equal(ran.state, "red");
  assert.equal(ran.steps.find(s => s.name === "examples")?.verdict, "PASS", "the outer gate's fail-fast did not reach this run");
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
