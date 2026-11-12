import {historyFile,writeCostHistory} from "../gate/step-scheduling.ts";
import {testEnvironmentHandoff,fixtureEnvironment} from "../gate/test-environment.ts";
// What holds a landing (run.ts): memory it waits for in the ledger, a tree
// without history, pressure that never clears, a hung or stuck step at the
// ceiling, a gate that cannot say what its steps need, and pending lines as
// information. Shared helpers are in run-fixture.ts.
import {test} from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {PROFILE,pendingLines,runLanding} from "./run.ts";
import {gib,jobSizing,readLedger} from "../gate/memory-ledger.ts";
import {STEPS} from "../gate/step-table.mjs";
import {peakReservation} from "../gate/step-scheduling.ts";
import {spawnTest,waitFor} from "../gate/test-wait.ts";
import {fixture,HOLDER} from './run-fixture.ts';

test("memory the run waits for is a hold, never a verdict: the build waits its turn in the ledger, at the landing check's priority, and its gate run takes its reservation over", async t => {
  const f = fixture(t);
  // The build reserves what this tree's earlier landing builds held, 8 GiB in
  // all, per worker of the build step's row. 61 GiB available, 2 kept for the
  // system: a 56 GiB job leaves too little for them, until the build asks and
  // the job ends. The job is another landing's: one of lower priority would
  // promise the build only what it uses (memory-ledger.ts).
  const workers = STEPS.find(row => row.name === "build")!.slots, history = historyFile(f.memory);
  mkdirSync(f.memory.NTS_GATE_COSTS_DIR, { recursive: true });
  assert.equal(writeCostHistory(history,{jobs:[{key:"landing-build",basis:"worker",width:workers,peak:Math.floor(8*2**30/workers/1.25)*workers}]}),undefined);
  const sized = jobSizing({ key: "landing-build", units: workers }, f.memory);
  assert.equal(sized.basis, "measured");
  const asked = gib(sized.bytes).replace(".", "\\.");
  const env: NodeJS.ProcessEnv = { ...fixtureEnvironment(t), ...f.memory };
  delete env.NTS_MEMORY_RESERVATION;
  const holder = spawn(process.execPath, [fileURLToPath(new URL("../gate/admit.ts", import.meta.url)), "--bytes", "56G", "--priority", "landing", "--what", "holder", "--",
    process.execPath, "--input-type=module", "-e", HOLDER, f.memory.NTS_MEMORY_LEDGER], { env, stdio: "ignore" });
  const ended = once(holder, "exit");
  t.after(async () => { if (holder.exitCode === null && holder.signalCode === null) { holder.kill("SIGKILL"); await ended; } });
  const exited = () => holder.exitCode !== null || holder.signalCode !== null ? `the holder exited ${holder.exitCode ?? holder.signalCode}` : undefined;
  await waitFor("the holder to be admitted", () => readLedger(f.memory.NTS_MEMORY_LEDGER).admitted.some(entry => entry.what === "holder"), { stopped: exited });
  const ran = await runLanding(f.options(["build", "outcomes"]));
  assert.equal(ran.state, "green", ran.message);
  const build = readFileSync(join(f.run, "build.log"), "utf8");
  assert.match(build, new RegExp(`memory: landing build of [0-9a-f]{12} waits for ${asked} \\(landing\\): `));
  assert.match(build, new RegExp(`memory: landing build of [0-9a-f]{12} admitted with ${asked} after \\d+ s`));
  // Nothing was admitted between the build and its gate run: the run's first
  // request took the build's reservation over as it was admitted.
  const gate = readFileSync(join(f.run, "gate.log"), "utf8");
  assert.match(gate, new RegExp(`memory: gate run \\S+ took over landing build of [0-9a-f]{12}'s reservation of ${asked}\n`));
  assert.doesNotMatch(gate, /memory: .* drew /, "what it takes over it does not also draw on");
  assert.deepEqual(await ended, [0, null], "the holder ended once the build asked");
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER), { waiting: [], admitted: [] }, "and nothing of the landing is left in the ledger");
});

test("a --here run at the agent priority yields its unused reservation to a service run on one ledger", async t => {
  const here = fixture(t), service = fixture(t);
  // Both builds reserve what this shared history held, 56 GiB in all: on
  // the fixture's 61 GiB reading, two such grants cannot both count whole
  // (61 less the system's 2 GiB floor), so the service run is admitted
  // only over the part of the --here grant its build is not using.
  const workers = STEPS.find(row => row.name === "build")!.slots, history = historyFile(here.memory);
  mkdirSync(here.memory.NTS_GATE_COSTS_DIR, { recursive: true });
  assert.equal(writeCostHistory(history,{jobs:[{key:"landing-build",basis:"worker",width:workers,peak:Math.floor(56*2**30/workers/1.25)*workers}]}),undefined);
  const shared = { NTS_GATE_SLOTS: "4", ...here.memory };
  const entryOf = (path: string) => `import {copyFileSync} from "node:fs";import {join} from "node:path";copyFileSync(join(process.env.NTS_MEMORY_LEDGER,"admitted",process.env.NTS_MEMORY_RESERVATION+".json"),${JSON.stringify(path)});`;
  const hereEntry = join(here.own, "here-entry.json"), serviceEntry = join(here.own, "service-entry.json");
  const started = join(here.own, "here-started"), release = join(here.own, "here-release");
  const holding = `${entryOf(hereEntry)}import {existsSync,watch,writeFileSync} from "node:fs";import {dirname} from "node:path";` +
    `writeFileSync(${JSON.stringify(started)},"x");await new Promise(resolve=>{const done=()=>{if(existsSync(${JSON.stringify(release)})){watcher.close();resolve();}};const watcher=watch(dirname(${JSON.stringify(release)}),done);done();});`;
  // The --here run runs in a process of its own: its build is spawned
  // synchronously by runLanding, so in this process it would freeze the
  // service run out of its own event loop rather than out of memory.
  const hereResult = join(here.own, "here-result.json");
  const commit = spawnTest("git", ["-C", here.tree, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const child = spawn(process.execPath, ["--input-type=module", "-e",
    `import {runLanding} from ${JSON.stringify(new URL("./run.ts", import.meta.url).href)};` +
    `import {durableRecord} from ${JSON.stringify(new URL("../gate/durable-record.ts",import.meta.url).href)};` +
    `const ran=await runLanding({tree:${JSON.stringify(here.tree)},target:${JSON.stringify(here.target)},run:${JSON.stringify(here.run)},commit:${JSON.stringify(commit)},steps:["build"],priority:"agent",` +
    `env:{...${testEnvironmentHandoff()},HOME:${JSON.stringify(join(here.own, "home"))}},owned:{NTS_GATE_SLOTS:"4",...${JSON.stringify(here.memory)}},build:[process.execPath,"--input-type=module","-e",${JSON.stringify(holding)}]});` +
    `durableRecord(${JSON.stringify(hereResult)},{state:ran.state});`],
    { env: { ...fixtureEnvironment(t) }, stdio: ["ignore", "ignore", "pipe"] });
  let childStderr = "";
  child.stderr.setEncoding("utf8").on("data", (data: string) => { childStderr += data; });
  const childEnded = once(child, "exit");
  try {
    await waitFor("the --here build to hold its reservation", () => existsSync(started),
      { stopped: () => child.exitCode !== null || child.signalCode !== null ? `the --here run exited ${child.exitCode ?? child.signalCode}: ${childStderr}` : undefined });
    assert.equal((JSON.parse(readFileSync(hereEntry, "utf8")) as { priority: string }).priority, "agent");

    const serviceRan = await runLanding(service.options(["build"], { owned: shared, build: [process.execPath, "--input-type=module", "-e", entryOf(serviceEntry)] }));
    assert.equal(serviceRan.state, "green", serviceRan.message);
    assert.equal((JSON.parse(readFileSync(serviceEntry, "utf8")) as { priority: string }).priority, "landing");
    assert.equal(child.exitCode, null, "the service run was admitted over the --here run's unused memory, without it ending");

    writeFileSync(release, "x");
    assert.deepEqual(await childEnded, [0, null], childStderr);
    assert.equal((JSON.parse(readFileSync(hereResult, "utf8")) as { state: string }).state, "green");
    assert.deepEqual(readLedger(here.memory.NTS_MEMORY_LEDGER), { waiting: [], admitted: [] });
  } finally {
    try { writeFileSync(release, "x"); } catch { /* the fixture is gone */ }
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await childEnded.catch(() => {});
  }
});

test("a tree with no history admits its landing build by live use, without guessing a share per cargo job", async t => {
  const f = fixture(t);
  const workers = STEPS.find(row => row.name === "build")!.slots;
  const sized = jobSizing({ key: "landing-build", units: workers }, f.memory), cargo = jobSizing({ key: "landing-build", units: 24 }, f.memory);
  assert.deepEqual([sized.bytes,sized.basis], [0,"live"]);
  assert.deepEqual([cargo.bytes,cargo.basis], [sized.bytes,sized.basis], "a worker count cannot forecast an unmeasured job");
  // The build copies its own entry in the ledger, which the landing names in its environment.
  const entry = join(f.own, "build-entry.json");
  const ran = await runLanding(f.options(["build", "rustfmt"], { build: ["sh", "-c",
    `cat "$NTS_MEMORY_LEDGER/admitted/$NTS_MEMORY_RESERVATION.json" > ${JSON.stringify(entry)}; mkdir -p "$CARGO_TARGET_DIR/${PROFILE}"; printf '#!/bin/sh\\n' > "$NTS_BIN"; chmod +x "$NTS_BIN"`] }));
  assert.equal(ran.state, "green", ran.message);
  const held = JSON.parse(readFileSync(entry, "utf8")) as { bytes: number; liveUse?: boolean; unmeasured?: string[] };
  assert.deepEqual([held.bytes, held.liveUse, held.unmeasured], [peakReservation([1]), true, ["landing-build"]]);
});

test("pressure that never clears, and a hung step, hold the change for a person", async t => {
  const f = fixture(t);
  f.control("examples", "always-pressure");
  const pressed = await runLanding(f.options(["build", "examples"], { attempts: 2 }));
  assert.equal(pressed.state, "held");
  assert.match(pressed.message, /examples INSTRUMENT/);
  const g = fixture(t);
  g.control("outcomes", "hung");
  const hung = await runLanding(g.options(["build", "outcomes"]));
  assert.equal(hung.state, "held");
  assert.match(hung.message, /outcomes NOT RUN: no progress for 600 s/);
});

test("the landing check's ceiling reaches the runner: a stuck step is stopped there and holds the change", async t => {
  const f = fixture(t);
  f.control("outcomes", "stuck");
  const ran = await runLanding(f.options(["build", "outcomes"], { ceiling: 2 }));
  assert.equal(ran.state, "held", ran.message);
  assert.match(ran.message, /outcomes INSTRUMENT: step exceeded its bound of 2 s/);
  assert.deepEqual(ran.steps.map(s => `${s.name} ${s.verdict}`), ["build PASS", "outcomes INSTRUMENT"]);
  // The completed control has its own ceiling: it proves the explicit ceiling
  // leaves completed work intact, without requiring a real scope to enter and
  // exit inside the stuck control's deliberately tiny two-second allowance.
  const control = fixture(t);
  const completed = await runLanding(control.options(["build", "rustfmt"], { ceiling: 60 }));
  assert.equal(completed.state, "green", completed.message);
  assert.deepEqual(completed.steps.map(s => `${s.name} ${s.verdict}`), ["build PASS", "rustfmt PASS"]);
  const row = JSON.parse(readFileSync(join(control.run, "summary.json"), "utf8")).steps[0];
  assert.equal(row.bound_s, 60);assert.equal(row.bound_basis, "ceiling");
});

test("a tree whose gate cannot say what its steps need holds the change", async t => {
  const f = fixture(t);
  writeFileSync(join(f.tree, "tooling/gate/run.mjs"), "throw new Error('a runner this change broke');\n");
  const ran = await runLanding(f.options(["build", "outcomes"]));
  assert.equal(ran.state, "held");
  assert.match(ran.message, /could not say what its steps need: infrastructure probe read gate capability declarations/);
  assert.match(ran.message, /a runner this change broke/);
});

test("pending and improved lines are listed as information, and pass", async t => {
  const f = fixture(t);
  f.control("outcomes", "pending");
  const ran = await runLanding(f.options(["build", "outcomes"]));
  assert.equal(ran.state, "green", ran.message);
  assert.deepEqual(ran.pending, ["pending: tests/x/a.ts is not recorded in results/x.tsv yet", "improved, record pending: tests/x/b.ts refused -> pass"]);
  assert.deepEqual(pendingLines(join(f.run, "nowhere")), []);
});
