// What holds a landing (run.ts): memory it waits for in the ledger, a tree
// without history, pressure that never clears, a hung or stuck step at the
// ceiling, a gate that cannot say what its steps need, and pending lines as
// information. Shared helpers are in run-fixture.ts.
import {test} from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {PROFILE,pendingLines,runLanding} from "./run.ts";
import {gib,jobSizing,readLedger} from "../gate/memory-ledger.ts";
import {STEPS} from "../gate/step-table.mjs";
import {peakReservation} from "../gate/step-scheduling.ts";
import {waitFor} from "../gate/test-wait.ts";
import {fixture,HOLDER} from './run-fixture.ts';

test("memory the run waits for is a hold, never a verdict: the build waits its turn in the ledger, at the landing check's priority, and its gate run takes its reservation over", async t => {
  const f = fixture(t);
  // The build reserves what this tree's earlier landing builds held, 8 GiB in
  // all, per worker of the build step's row. 61 GiB available, 2 kept for the
  // system: a 56 GiB job leaves too little for them, until the build asks and
  // the job ends. The job is another landing's: one of lower priority would
  // promise the build only what it uses (memory-ledger.ts).
  const workers = STEPS.find(row => row.name === "build")!.slots, history = join(f.memory.NTS_GATE_COSTS_DIR, "steps.json");
  mkdirSync(f.memory.NTS_GATE_COSTS_DIR, { recursive: true });
  writeFileSync(history, JSON.stringify({ version: 3, steps: {}, jobs: { "landing-build": { unit: "worker", peaks: [Math.floor(8 * 2 ** 30 / workers / 1.25)] } } }) + "\n");
  const sized = jobSizing({ key: "landing-build", units: workers }, f.memory);
  assert.equal(sized.basis, "measured");
  const asked = gib(sized.bytes).replace(".", "\\.");
  const env: NodeJS.ProcessEnv = { ...process.env, ...f.memory };
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
  assert.match(ran.message, /could not say what its steps need: cannot read gate capabilities/);
});

test("pending and improved lines are listed as information, and pass", async t => {
  const f = fixture(t);
  f.control("outcomes", "pending");
  const ran = await runLanding(f.options(["build", "outcomes"]));
  assert.equal(ran.state, "green", ran.message);
  assert.deepEqual(ran.pending, ["pending: tests/x/a.ts is not recorded in results/x.tsv yet", "improved, record pending: tests/x/b.ts refused -> pass"]);
  assert.deepEqual(pendingLines(join(f.run, "nowhere")), []);
});
