import {STEP_CPU_MEASURE,GNU_CPU_MEASURE} from './step-time.ts';
import {fixtureEnvironment} from "./test-environment.ts";
import assert from "node:assert/strict";
import {moduleClosure} from "./module-closure-fixture.ts";
import {oracleWorkspaceFixture} from "../differential/oracle-workspace-fixture.ts";
import {test} from "node:test";
import {copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync} from "node:fs";
import {join, dirname} from "node:path";

import {fileURLToPath, pathToFileURL} from "node:url";
import {gateEnvironment, hostEnvironment} from "./canonical-environment.ts";
import {removable} from "./run-temporary.ts";
import {spawnTest} from "./test-wait.ts";
import {spawn, spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {newToolingSlice, stopToolingSlice, toolingSlice} from "./tooling-slice.ts";
import {once} from "node:events";
import {COST_HISTORY_VERSION,historyFile as schedulingHistoryFile,RESERVATION_PER_PEAK, caseMemoryKey, caseHistoryFile, caseReservation, elasticHeldBytes, readCaseHistory, writeCaseHistory, inheritedStepWork, KEPT_PEAKS, LEAST_RESERVATION_BYTES, machineShare, orderStepStarts, peakReservation, readCostHistory, readPreviousStepCpu, stepCpu,
  unitReservation, jobReservation, usableWidth, writeCostHistory} from "./step-scheduling.ts";
import {testScratch, newTestScratch} from "./test-scratch.ts";
import {ownMemory, type OwnMemory} from "./test-memory.ts";
import {OOM_SCORE,readLedger} from "./memory-ledger.ts";

// Scheduling vectors are fixture-owned CPU observations of the current measure.
const fixtureBaseline=(text:string)=>text.split('\n').map(line=>line&&!line.startsWith('#')&&line.split('\t').length===4?line+'\t'+STEP_CPU_MEASURE:line).join('\n');

test("equal and missing estimates have a deterministic name tie-break", () => {
  const names = ["typescript-c", "tests", "blockers", "integrity"];
  const expected = ["blockers", "integrity", "tests", "typescript-c"];
  for (const input of [names, [...names].reverse()]) {
    assert.deepEqual(orderStepStarts(input, () => 60), expected);
    assert.deepEqual(orderStepStarts(input, () => NaN), expected);
  }
  assert.deepEqual(orderStepStarts(names, name => ({ "typescript-c": 1000, tests: 900 } as Record<string, number>)[name] ?? 100),
    ["typescript-c", "tests", "blockers", "integrity"]);
});

test("completed CPU history survives small runs and corrupt or failed cache writes are harmless", t => {
  const own = testScratch(t, "step-scheduling-history");
  const previous = join(own, "summary.json"), file = join(own, "costs/steps.json");
  writeFileSync(previous, JSON.stringify({ schema: 1, environment: { canonical: true }, steps: [
    { name: "typescript-c", verdict: "PASS", cpu_measure:STEP_CPU_MEASURE, wall: 1067, cpu: 2663 }, { name: "blockers", verdict: "NOT RUN", wall: 900, cpu: 900 },
  ] }));
  const seed = readPreviousStepCpu(previous);
  assert.deepEqual([...seed], [["typescript-c", 2663]]);
  const cpu = () => [...stepCpu(readCostHistory(file))];
  assert.equal(writeCostHistory(file, { steps: [{ name: "rustfmt", verdict: "PASS", cpu_measure:STEP_CPU_MEASURE,cpu: 2 }] }, seed), undefined);
  assert.deepEqual(cpu(), [["rustfmt", 2], ["typescript-c", 2663]]);
  assert.equal(writeCostHistory(file, { steps: [{ name: "typescript-c", verdict: "PASS", cpu_measure:STEP_CPU_MEASURE,cpu: 600 },
    { name: "blockers", verdict: "FAIL", cpu: 1 }] }), undefined);
  assert.deepEqual(cpu(), [["rustfmt", 2], ["typescript-c", 600]]);
  writeFileSync(file, JSON.stringify({ version: 2, steps: { "typescript-c": 1067 } }));
  assert.deepEqual(cpu(), [], "legacy rusage CPU cannot seed the new instrument");
  writeFileSync(file, JSON.stringify({ version: 1, steps: { "typescript-c": 1067 } }));
  assert.equal(readCostHistory(file).steps.size, 0, "a wall-time history from before is not read as work");
  writeFileSync(file, "partial{"); assert.equal(readCostHistory(file).steps.size, 0);
  const blocked = join(own, "not-a-directory"); writeFileSync(blocked, "preserve");
  assert.equal(typeof writeCostHistory(join(blocked, "steps.json"), {}), "string");
  assert.equal(readFileSync(blocked, "utf8"), "preserve");
  assert.equal(typeof writeCostHistory(join(own, "removed", "costs", "steps.json"), { jobs: [{key:"agree",peak:1,basis:"worker",width:1}] }), "string",
    "a history whose directory's parent has gone is not made again: a test's removed scratch stays removed");
  writeFileSync(previous, JSON.stringify({ schema: 1, environment: { canonical: false }, steps: [
    { name: "typescript-c", verdict: "PASS", cpu: 1 },
  ] }));
  assert.equal(readPreviousStepCpu(previous).size, 0);
});

test("a key's last few peaks are kept, per unit, and one small run does not shrink its reservation", t => {
  const file = join(testScratch(t, "step-scheduling-peaks"), "costs/steps.json");
  const MiB = 2 ** 20;
  const run = (peak: number) => assert.equal(writeCostHistory(file, { steps: [{ name: "tests", verdict: "PASS", cpu_measure:STEP_CPU_MEASURE,cpu: 10, memory: { unit: "step", peak } }],
    jobs: [{key:"agree",peak:peak/2,basis:"worker",width:1}] }), undefined);
  for (const peak of [800, 1000, 900, 950, 990, 100]) run(peak * MiB);
  const history = readCostHistory(file);
  assert.deepEqual(history.steps.get("tests"), { cpu: 10, memory: { unit: "step", peaks: [1000, 900, 950, 990, 100].map(peak => peak * MiB) } },
    `the last ${KEPT_PEAKS} peaks, oldest first, beside the CPU seconds`);
  assert.deepEqual(history.jobs.get("agree"), {basis:"worker",observations:[500,450,475,495,50].map(peak=>({peak:peak*MiB,width:1}))});
  assert.equal(peakReservation(history.steps.get("tests")!.memory!.peaks), 1250 * MiB, "1.25 times the largest: the small last run shrinks nothing");
  assert.equal(peakReservation([MiB]), LEAST_RESERVATION_BYTES, "never less than the least reservation");
  assert.equal(peakReservation([1000 * MiB + 1]), 1251 * MiB, "rounded up to a whole MiB");
  // A step that changed unit (fixed, now elastic) starts its peaks again.
  assert.equal(writeCostHistory(file, { steps: [{ name: "tests", memory: { unit: "token", peak: 64 * MiB } }] }), undefined);
  assert.deepEqual(readCostHistory(file).steps.get("tests"), { cpu: 10, memory: { unit: "token", peaks: [64 * MiB] } });
  writeFileSync(file, JSON.stringify({ version: 3, steps: { tests: { memory: { unit: "step", peaks: [] } } }, jobs: {} }));
  assert.equal(readCostHistory(file).steps.size, 0, "a key with no peaks is not a history");
});

test("an unmeasured step reserves the largest of its kind, and with nothing measured, its share of the machine", () => {
  const GiB = 2 ** 30, MiB = 2 ** 20;
  const history = { steps: new Map([
    ["tests", { cpu: 1, memory: { unit: "step" as const, peaks: [4 * GiB] } }],
    ["format", { memory: { unit: "step" as const, peaks: [64 * MiB] } }],
    ["integrity", { memory: { unit: "token" as const, peaks: [400 * MiB] } }],
  ]), jobs: new Map([["agree", {basis:"worker" as const,observations:[{peak:800*MiB,width:1}]}]]) };
  assert.deepEqual(unitReservation(history, { step: "tests" }, "step", 1), { bytes: 5 * GiB, basis: "measured" });
  assert.deepEqual(unitReservation(history, { step: "format" }, "step", 1), { bytes: LEAST_RESERVATION_BYTES, basis: "measured" });
  assert.deepEqual(unitReservation(history, { step: "clippy" }, "step", 1), { bytes: 5 * GiB, basis: "largest" }, "the largest fixed step's");
  assert.deepEqual(unitReservation(history, { step: "examples" }, "token", 1), { bytes: 500 * MiB, basis: "largest" }, "the largest token's");
  assert.deepEqual(unitReservation(history, { step: "integrity" }, "step", 7), { bytes: 5 * GiB, basis: "largest" },
    "peaks measured per token say nothing of the step as a whole");
  assert.deepEqual(jobReservation(history,"record-oracles","worker"), { bytes: 0, basis: "live" }, "an unrelated job is no forecast");
  const empty = { steps: new Map(), jobs: new Map() };
  assert.deepEqual(unitReservation(empty, { step: "tests" }, "step", machineShare(32 * GiB, 8, 24)), { bytes: Math.floor(32 * GiB / 3), basis: "share" });
  assert.equal(machineShare(32 * GiB, 48, 24), 32 * GiB, "never more than the machine");
});

test("a split step's measured work is shared among its successors, never copied to each", () => {
  const successors = { "typescript-cases": { steps: ["typescript-c", "typescript-llvm", "typescript-jvm"] }, retired: { steps: [] } };
  const baseline = new Map([["typescript-c", 3000], ["typescript-llvm", 2000], ["typescript-jvm", 1000]]);
  const proportional = inheritedStepWork(new Map([["typescript-cases", 6000], ["retired", 500]]), name => baseline.get(name), successors);
  assert.deepEqual([...proportional].sort(), [["typescript-c", 3000], ["typescript-jvm", 1000], ["typescript-llvm", 2000]]);
  const equal = inheritedStepWork(new Map([["typescript-cases", 6000]]), name => name === "typescript-jvm" ? undefined : baseline.get(name), successors);
  assert.deepEqual([...equal].sort(), [["typescript-c", 2000], ["typescript-jvm", 2000], ["typescript-llvm", 2000]]);
  const measured = inheritedStepWork(new Map([["typescript-cases", 6000], ["typescript-c", 2663]]), name => baseline.get(name), successors);
  assert.deepEqual([...measured].sort(), [["typescript-jvm", 1000], ["typescript-llvm", 2000]], "a successor's own completed run wins");
  assert.equal(inheritedStepWork(new Map(), name => baseline.get(name), successors).size, 0);
  const merge = { "old-a": { steps: ["merged"] }, "old-b": { steps: ["merged"] } };
  assert.equal(inheritedStepWork(new Map([["old-a", 10], ["old-b", 20]]), () => undefined, merge).size, 0,
    "two measured predecessors of one step may be a merge or a rename chain, so neither is inherited");
  assert.deepEqual([...inheritedStepWork(new Map([["old-a", 10]]), () => undefined, merge)], [["merged", 10]]);
});

test("a step's usable width counts the frontend cap, so a capped step is not ranked as if it ran at full width", () => {
  const steps: Record<string, { slots: number; fe?: boolean }> = { frontend: { slots: 8, fe: true }, other: { slots: 2 } };
  const budget = { slots: 24, frontends: 2 };
  assert.equal(usableWidth(steps.frontend!, budget), 2);
  assert.equal(usableWidth(steps.other!, budget), 2);
  assert.equal(usableWidth({ slots: 8, fe: true }, { slots: 24, frontends: 24 }), 8);
  assert.equal(usableWidth({}, budget), 1);
  const work: Record<string, number> = { frontend: 800, other: 400 };
  assert.deepEqual(orderStepStarts(["other", "frontend"], name => work[name]! / usableWidth(steps[name]!, budget)), ["frontend", "other"]);
});

test("measured CPU work starts TypeScript at full width against a competing fixed grant", t => {
  const own = newTestScratch("step-scheduling-run");t.after(() => {removable(own);rmSync(own, {recursive:true,force:true});});
  const root = join(own, "repo"), gate = join(root, "tooling/gate"), target = join(own, "target"), run = join(own, "gate-run");
  mkdirSync(gate, { recursive: true }); mkdirSync(join(target, "gate-costs"), { recursive: true });
  const source = fileURLToPath(new URL("./", import.meta.url));
  for(const file of moduleClosure(["tooling/gate/run.mjs"])){
    const destination=join(root,file),original=join(source,"../..",file);
    mkdirSync(dirname(destination),{recursive:true});
    if(file==="tooling/gate/run.mjs")writeFileSync(destination,readFileSync(original));
    else copyFileSync(original,destination);
  }
  oracleWorkspaceFixture(t,root);
  const baseline = fixtureBaseline("tests\t900\t10000\t8\ntypescript-c\t1\t1\t8\ntypescript-oracles\t1\t1\t8\n");
  writeFileSync(join(gate, "times.tsv"), baseline);
  // The run's history is the test's own, as its memory is.
  const memory = ownMemory(join(own, "memory"),{cpu:{kind:"fixed",default:{usageUsec:5_000_000,userUsec:4_000_000,systemUsec:1_000_000}}}), historyFile = schedulingHistoryFile(memory);
  mkdirSync(memory.NTS_GATE_COSTS_DIR);
  writeFileSync(historyFile, JSON.stringify({version:4,cpu_measure:STEP_CPU_MEASURE,jobs:{},steps:{tests:{cpu:100},"typescript-c":{cpu:8000},"typescript-oracles":{cpu:16000}}}) + "\n");
  const listed = spawnTest("sh", [join(source, "all.sh"), "--list"], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  const observed = join(own, "starts.jsonl");
  writeFileSync(join(gate, "all.sh"), `#!/bin/sh
if [ "$1" = --list ]; then
cat <<'NAMES'
${listed.stdout.trim()}
NAMES
else
  node --input-type=module -e 'import {appendFileSync} from "node:fs";import {createTypeScriptOracleResults,openTypeScriptOracleResults} from ${JSON.stringify(new URL("../census/typescript-oracle-results.ts",import.meta.url).href)};import {typeScriptOracleDirectory} from ${JSON.stringify(new URL("../census/typescript-oracle-capture.ts",import.meta.url).href)};import {join} from "node:path";if(process.env.NTS_GATE_STEP==="typescript-oracles")createTypeScriptOracleResults(join(typeScriptOracleDirectory(),"results"),"a".repeat(64)).publish();if(process.env.NTS_GATE_STEP==="typescript-c"&&openTypeScriptOracleResults(JSON.parse(process.env.NTS_TYPESCRIPT_ORACLE),"a".repeat(64)).count!==0)throw Error("fixture oracle publication differs");appendFileSync(${JSON.stringify(observed)},JSON.stringify({step:process.env.NTS_GATE_STEP,slots:Number(process.env.NTS_GATE_JOBS)})+"\\n");'
fi
`);
  const compiler = join(own, "nts"); writeFileSync(compiler, "controlled compiler identity\n");
  // Publishing the fixture's empty reference must never reuse an outer
  // TypeScript producer's capture directory.
  const planned = gateEnvironment(hostEnvironment(process.env), { run, oracleRoot:root, owned: {
    NTS_GATE_STEPS: "tests typescript-c", NTS_GATE_SLOTS: "12",
    ...memory, CARGO_TARGET_DIR: target, NTS_BIN: compiler,
  } });
  assert.equal(JSON.parse(planned.env.NTS_ORACLE_DEPENDENCIES!).directory,join(run,"tmp/oracle-dependencies"));
  const actual = spawnTest(process.execPath, [join(gate, "run.mjs")], { cwd: root, env: planned.env, encoding: "utf8" });
  assert.equal(actual.status, 0, actual.stdout + actual.stderr);
  const summary = JSON.parse(readFileSync(join(run, "summary.json"), "utf8")) as {
    environment?: { canonical?: boolean }; steps: { name: string; slots: number; cpu?: number }[];
  };
  assert.equal(summary.steps.find(step => step.name === "typescript-oracles")?.slots, 8, "the shared producer starts its whole pool of workers");
  assert.equal(summary.steps.find(step => step.name === "typescript-c")?.slots, 8, "the census starts its whole pool of workers");
  const starts = readFileSync(observed, "utf8").trim().split("\n").map(line => JSON.parse(line) as { step: string; slots: number });
  assert.deepEqual(starts.map(row => row.step).sort(), ["tests", "typescript-c", "typescript-oracles"]);
  const admissions = [...actual.stderr.matchAll(/^-- ([a-z-]+) started /gm)].map(match => match[1]);
  assert.deepEqual(admissions, ["typescript-oracles", "tests", "typescript-c"], "measured CPU work takes precedence over the committed baseline");
  assert.equal(readFileSync(join(gate, "times.tsv"), "utf8"), baseline, "scheduling must never rewrite timing-verdict baselines");
  // Only a canonical run writes the history (run.mjs); this test's run is
  // canonical alone and not inside a gate, whose variables make it an experiment.
  const measured = summary.steps.find(step => step.name === "typescript-c")?.cpu;
  const written = summary.environment?.canonical === true && typeof measured === "number" && measured > 0;
  assert.equal(JSON.parse(readFileSync(historyFile, "utf8")).version,COST_HISTORY_VERSION);
  assert.equal(stepCpu(readCostHistory(historyFile)).get("typescript-c"), written ? measured : 8000,
    "a canonical run records the step's measured CPU; any other run leaves the history as it was");
});

const GiB = 2 ** 30, MiB = 2 ** 20;
type MemoryRow = {
  slots: number; min?: number; elastic?: boolean; after?: string[]; bound: number;
  /** GiB the step reserves (one token's, for an elastic step), as its history in the test's own target says; none, and it has no history. */
  reserve?: number;
};
type MemoryStep = { name: string; verdict: string; reason?: string; started_at: string; wall: number; memory_peak_bytes: number | null; log: string;
  instrument?: { kind: string };
  memory: { peak_bytes: number | null; reserved_bytes: number; over: boolean; basis: string;
    grant_bytes: number; grown_bytes: number; bound_bytes: number; killed: number | null } };
/** The peak a history holds for a step to reserve `bytes`, a whole MiB of at least 128: 1.25 times it, rounded up to a MiB. */
const peakFor = (bytes: number) => Math.floor(bytes / 1.25);

// Exits once its argument exists, or, with --entry, once the ledger directory
// it names holds a request: the fixture's steps wait on events, never on time.
const UNTIL = `import { existsSync, mkdirSync, readdirSync, watch } from "node:fs";
import { dirname } from "node:path";
const [path, kind] = process.argv.slice(2), dir = kind === "--entry" ? path : dirname(path);
mkdirSync(dir, { recursive: true });
const ready = () => kind === "--entry" ? readdirSync(path).some(name => name.endsWith(".json")) : existsSync(path);
await new Promise(resolve => { const watcher = watch(dir, () => { if (ready()) { watcher.close(); resolve(); } }); if (ready()) { watcher.close(); resolve(); } });
`;

type MemoryFixture = {
  steps: string; rows: Record<string, MemoryRow>; times: string;
  /** A shell script every step runs, given the step's name and the fixture's directory. */
  payload: string;
  availableKiB: number;
  /** The machine's size, 32 GiB unless given. */
  totalKiB?: number;
  /** Only kernel wiring controls opt into actual resident sampling. */
  liveResident?:boolean;
  /** Values the launcher's code owns beyond the fixture's. */
  owned?: Record<string, string>;
  /** The run's place in the ledger's queue, as its launcher's code gives it. */
  priority?: "landing" | "agent" | "full-check";
  /** A controlled initial unit score; otherwise preserve the test's score. */
  oomScore?: number;
  /** Runs before the runner starts, with the fixture's directory and memory. */
  before?: (own: string, memory: OwnMemory) => void;
  /** A private runner acknowledges this actual charge through the fixture's FIFO. */
  acknowledgeCharge?: number;
  acknowledgeYield?: boolean;
  /** Pause only the staged runner between giving back and publishing growth. */
  handoffBarrier?:'before'|'after';
  /** Observe excessive positive growth only in the private staged runner. */
  excessGrowth?:'before'|'after';
  /** Fail only the staged terminal owner, after the actual cleanup request. */
  lateCleanup?:'broker'|'ledger';
  reportOrder?:'before'|'after';
};

/**
 * A real runner over `steps` in a scratch repository: the real step table with
 * `rows` in place of those steps' own, every step running `payload`, on a
 * 32 GiB machine with `availableKiB` of it available, read from a file the
 * test writes, a memory ledger of the run's own, and a history of its own in
 * which each row's step reserves what the row says.
 */
function memoryRun(t: { after: (fn: () => void) => void }, { steps, rows, times, payload, availableKiB, totalKiB = 32 * 2 ** 20, liveResident=false,owned = {}, priority, oomScore = Number(readFileSync("/proc/self/oom_score_adj", "utf8")), before, acknowledgeCharge, acknowledgeYield,handoffBarrier,excessGrowth,lateCleanup,reportOrder }: MemoryFixture) {
  const own = newTestScratch("step-scheduling-memory");
  const inherited = toolingSlice(), unit = `nts-test-step-memory-${randomUUID()}`, slice = inherited ?? newToolingSlice(true);
  t.after(() => {
    spawnSync("systemctl", ["--user", "stop", unit], {env:fixtureEnvironment(t), stdio: "ignore" });
    if (!inherited) stopToolingSlice(slice);
    removable(own); rmSync(own, { recursive: true, force: true });
  });
  const root = join(own, "repo"), gate = join(root, "tooling/gate"), target = join(own, "target"), run = join(own, "home/.cache/gate-run");
  mkdirSync(gate, { recursive: true }); mkdirSync(join(target, "gate-costs"), { recursive: true });
  const source = fileURLToPath(new URL("./", import.meta.url));
  for (const name of moduleClosure(["tooling/gate/run.mjs"])) {
    const destination = join(root, name), original = join(source, "../..", name);
    mkdirSync(dirname(destination), { recursive: true });
    if (name === "tooling/gate/run.mjs") {
      let source = readFileSync(original, "utf8");
      if(lateCleanup){
        const report="registerCommandCloser('gate run report '+RUN_DIR,{",resources="registerCommandCloser('gate run resources '+RUN_DIR,{",end='mkdirSync(RUN_DIR, { recursive: true });';
        assert.ok(source.includes(report)&&source.includes(resources)&&source.includes(end),'cleanup control follows the actual registered owners');
        if(lateCleanup==='broker')source=source.replace(report,"const realBrokerClose=tok.close;tok.close=()=>{realBrokerClose();throw Error('late broker cleanup control');};\n"+report);
        else{
          const ledger='try{await reservation?.closed;}';assert.ok(source.includes(ledger));
          source=source.replace(ledger,"try{await reservation?.closed;throw Error('late ledger cleanup control');}");
        }
        if(reportOrder==='before'){
          const first=source.indexOf(report),second=source.indexOf(resources),last=source.indexOf(end,second);
          source=source.slice(0,first)+source.slice(second,last)+source.slice(first,second)+source.slice(last);
        }
      }
      if(excessGrowth){
        const condition='bytes < growth.bytes && !growth.withdrawn';
        const end='    return;\n  }\n  if (bytes <= 0 || yielding) return;';
        assert.ok(source.includes(condition)&&source.includes(end),'the growth replay follows the current ticket owner');
        if(excessGrowth==='before')source=source.replace(condition,'need <= 0 && !growth.withdrawn');
        source=source.replace(end,`    if(u.bytes===0 && bytes>0 && growth.bytes>bytes){
      process.stdout.write('control: growth observed '+JSON.stringify({reserved:reserved(),wanted:memoryWanted,queued:growth.bytes,useful:bytes,withdrawn:growth.withdrawn})+'\\n');
      if(!growth.withdrawn)stop('control: stale queued growth exceeds current demand');
    }
`+end);
      }
      if(handoffBarrier){
        const entry='function adjustMemory() {',shrink='reservation.shrink(back).catch',growth='  let need = Math.max(memoryWanted - reserved(), tokenShort(u),u.bytes+withholdBytes-reserved());';
        const protectedBack='Math.floor((reserved() - Math.max(memoryWanted, u.bytes + withholdBytes + 2 * BLOCK)) / BLOCK) * BLOCK';
        assert.ok(source.includes(entry)&&source.includes(shrink)&&source.includes(growth)&&source.includes(protectedBack),'handoff control follows the real retention and growth');
        // The before arm mutates this private closure copy, never the tree's
        // runner. Commit the fix before running the retained negative control.
        if(handoffBarrier==='before')source=source.replace(protectedBack,'Math.floor((reserved() - u.bytes - withholdBytes - 2 * BLOCK) / BLOCK) * BLOCK');
        source=source.replace(entry,'let handoffEntered=false,handoffAdjusting=false;\nasync function adjustMemory() {\n  if(handoffAdjusting)return;\n  handoffAdjusting=true;\n  try {')
          .replace(shrink,'await '+shrink)
          .replace('\n}\n\nfunction schedule()', '\n  } finally {handoffAdjusting=false;}\n}\n\nfunction schedule()')
          .replace(growth,`  if(!handoffEntered && memoryWanted === 8 * 2**30 && used().bytes === 0) {
    handoffEntered=true;
    const {watch}=await import('node:fs');
    await new Promise(resolve=>{
      const done=()=>{if(existsSync(${JSON.stringify(join(own,'neighbour-decided'))})){watcher.close();resolve();}};
      const watcher=watch(${JSON.stringify(own)},done);
      writeFileSync(${JSON.stringify(join(own,'handoff-ready'))},'ready');done();
    });
  }
`+growth);
      }
      if (acknowledgeYield) {
        const observation = "memoryRecord.outranked++;";
        assert.ok(source.includes(observation), "the barrier follows the real priority observation");
        source = source.replace(observation, observation + ` writeFileSync(${JSON.stringify(join(own,"yield-observed"))}, "observed");`);
      }
      if (acknowledgeCharge !== undefined) {
        const observation = "r.peakCharge = Math.max(r.peakCharge ?? 0, r.charge);";
        assert.ok(source.includes(observation), "the barrier follows the real charge observation");
        source = source.replace(observation, observation
          + ` if (!r.chargeAcknowledged && r.charge >= ${acknowledgeCharge}) { r.chargeAcknowledged = true; writeFileSync(${JSON.stringify(join(own, "charge-observed"))}, "observed"); }`);
      }
      writeFileSync(destination, source);
    }
    else if (name === "tooling/gate/step-table.mjs") {
      writeFileSync(destination, `import { STEPS as REAL, stepTableProblem } from ${JSON.stringify(pathToFileURL(original).href)};
const rows = ${JSON.stringify(Object.fromEntries(Object.entries(rows).map(([name, { reserve: _, ...row }]) => [name, row])))};
export const STEPS = REAL.map(row => Object.hasOwn(rows, row.name) ? { name: row.name, ...rows[row.name] } : row);
export { stepTableProblem };
`);
    } else symlinkSync(original, destination);
  }
  symlinkSync(join(source, "token.sh"), join(gate, "token.sh"));
  writeFileSync(join(gate, "times.tsv"), fixtureBaseline(times));
  writeFileSync(join(gate, "until.mjs"), UNTIL);
  writeFileSync(join(gate, "payload.sh"), payload);
  const listed = spawnTest("sh", [join(source, "all.sh"), "--list"], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  writeFileSync(join(gate, "all.sh"), `#!/bin/sh
if [ "$1" = --list ]; then
cat <<'NAMES'
${listed.stdout.trim()}
NAMES
else
  exec sh "$(dirname "$0")/payload.sh" "$2" ${JSON.stringify(own)}
fi
`);
  const memory = ownMemory(join(own, "memory"), { availableKiB, totalKiB,resident:liveResident?{kind:"live"}:{kind:"fixed",defaultBytes:2**20} });
  const history = schedulingHistoryFile(memory);
  mkdirSync(memory.NTS_GATE_COSTS_DIR);
  writeFileSync(history, JSON.stringify({ version: 3, jobs: {}, steps: Object.fromEntries(Object.entries(rows).flatMap(([name, row]) => row.reserve === undefined ? []
    : [[name, { memory: { unit: row.elastic ? "token" : "step", peaks: [peakFor(row.reserve * GiB)] } }]])) }) + "\n");
  before?.(own, memory);
  const planned = gateEnvironment({ ...hostEnvironment(process.env), HOME: join(own, "home") }, { run, owned: {
    NTS_GATE_STEPS: steps, NTS_GATE_SLOTS: "10", ...memory, NTS_TOOLING_SLICE: slice, CARGO_TARGET_DIR: target, ...(priority ? { NTS_MEMORY_PRIORITY: priority } : {}), ...owned,
  } });
  const setenv = Object.entries(planned.env).filter((pair): pair is [string, string] => pair[1] !== undefined).map(([key, value]) => `--setenv=${key}=${value}`);
  const result = spawnTest("systemd-run", ["--user", `--unit=${unit}`, `--slice=${slice}`, "--collect", "--wait", "--pipe", "--quiet",
    "--property=LimitCORE=0", "--property=Nice=19", "--property=CPUAffinity=0-3 6-31", "--property=RuntimeMaxSec=300s", "--property=TimeoutStopSec=5s",
    // A service is forked by the manager, so explicitly retain the caller's
    // score as a normal child would. The runner then raises it to its priority.
    `--property=OOMScoreAdjust=${Math.max(oomScore, OOM_SCORE.landing)}`,
    `--working-directory=${root}`, ...setenv, process.execPath, join(gate, "run.mjs")], { encoding: "utf8" });
  assert.ok(existsSync(join(run, "summary.json")), result.stdout + result.stderr);
  const summary = JSON.parse(readFileSync(join(run, "summary.json"), "utf8")) as {
    verdict: string; steps: MemoryStep[];scope_cleanup:{state:string;reason?:string};
    memory: { priority: string; peak_bytes: number; growths: number; withdrawn: number; shrinks: number; outranked: number; waited_s: number; unmeasured: string[]; over: string[];
      steps_grown: number; steps_killed: number };
  };
  const step = (name: string) => summary.steps.find(row => row.name === name)!;
  return { own,result, summary, step, output: result.stdout + result.stderr, history,ledger:memory.NTS_MEMORY_LEDGER, canonical: (summary as { environment?: { canonical?: boolean } }).environment?.canonical === true };
}

for(const lateCleanup of ['broker','ledger'] as const)test(`a late ${lateCleanup} cleanup failure is in the published summary before the tree lock ends`,t=>{
  const fixture={steps:'clippy',rows:{clippy:{slots:1,reserve:1}},times:'clippy\t1\t1\t1\n',payload:':',availableKiB:24*2**20,lateCleanup};
  const before=memoryRun(t,{...fixture,reportOrder:'before'});
  assert.equal(before.result.status,2,before.output);
  assert.equal(before.summary.verdict,'green','publishing before cleanup hides its failure');
  assert.equal(before.summary.scope_cleanup.state,'complete');
  const after=memoryRun(t,{...fixture,reportOrder:'after'});
  assert.equal(after.result.status,2,after.output);assert.equal(after.summary.verdict,'red');
  assert.equal(after.summary.scope_cleanup.state,'error');assert.match(after.summary.scope_cleanup.reason!,new RegExp('late '+lateCleanup+' cleanup control'));
  assert.deepEqual(readLedger(after.ledger),{waiting:[],admitted:[]},'the error does not bypass physical ledger cleanup');
});

test("steps whose memory together is more than the run can reserve run one after the other", t => {
  // 6.5 GiB available, 2 of them kept for the system: the run reserves 3 for
  // format and cannot grow by records' 3 more beside it.
  const { result, summary, step, output } = memoryRun(t, {
    steps: "format records", availableKiB: 6.5 * 2 ** 20,
    rows: { format: { slots: 1, reserve: 3, bound: 60 }, records: { slots: 1, reserve: 3, bound: 60 } },
    times: "format\t100\t200\t1\nrecords\t100\t100\t1\n",
    payload: `
case $1 in
  # Started first, it keeps its memory until the run has asked the ledger for
  # records' as well, and been told to wait.
  format) exec node "$(dirname "$0")/until.mjs" "$2/memory/ledger/waiting" --entry ;;
esac
` });
  assert.equal(result.status, 0, output);
  assert.equal(summary.verdict, "green");
  const format = step("format"), records = step("records");
  assert.ok(Date.parse(records.started_at) >= Date.parse(format.started_at) + format.wall * 1000 - 1,
    `records started at ${records.started_at}, before format ended: ${format.started_at} + ${format.wall} s`);
  assert.match(output, /memory: gate run .* waits to grow by 3\.0 GiB to 6\.0 GiB \(agent\)/);
  assert.deepEqual([summary.memory.priority, summary.memory.peak_bytes, summary.memory.growths, summary.memory.withdrawn], ["agent", 3 * GiB, 1, 1],
    "one block, grown by 2 for format; the growth for records withdrawn once format's memory came back");
  for (const row of [format, records]) assert.ok(row.memory_peak_bytes === null || row.memory_peak_bytes > 0, `${row.name}'s measured peak`);
});

for(const arm of ['before','after']as const)test(`excess queued growth is replaced after running work drains (${arm})`,t=>{
  const {result,summary,output}=memoryRun(t,{
    steps:'format records',availableKiB:22.5*2**20,excessGrowth:arm,
    rows:{format:{slots:1,reserve:10,bound:60},records:{slots:1,reserve:11,bound:60}},
    times:'format\t100\t200\t1\nrecords\t100\t100\t1\n',
    payload:`case $1 in
  format) exec node "$(dirname "$0")/until.mjs" "$2/memory/ledger/waiting" --entry ;;
  records) : > "$2/records-ran" ;;
esac\n`,
  });
  const observed=/^control: growth observed (\{[^\n]+\})$/m.exec(output);
  assert.ok(observed,'the runner reports its growth observation through its owned stdout:\n'+output);
  const seen=JSON.parse(observed[1]!) as {reserved:number;wanted:number;queued:number;useful:number;withdrawn:boolean};
  assert.deepEqual(seen,{reserved:10*GiB,wanted:11*GiB,queued:11*GiB,useful:GiB,withdrawn:arm==='after'});
  if(arm==='before'){
    assert.notEqual(result.status,0,output);assert.match(output,/control: stale queued growth exceeds current demand/);
  }else{
    assert.equal(result.status,0,output);assert.equal(summary.verdict,'green');
    assert.equal(summary.memory.peak_bytes,11*GiB);assert.equal(summary.memory.withdrawn,1);
  }
});

test("a fixed step waiting for memory is not starved by an elastic step's tokens", t => {
  // integrity's sixteen workers ask for a token again the moment a case ends,
  // and the reservation holds four of their 1 GiB shares at most: with each
  // case a node start, a dozen wait at any time, so a token that comes back
  // is taken again at once. format becomes ready once integrity runs, and
  // fits only when three of those shares are back at the same time.
  // integrity's cases go on until format has run.
  const { result, summary, output } = memoryRun(t, {
    steps: "integrity records format", availableKiB: 6.5 * 2 ** 20,
    rows: {
      integrity: { elastic: true, slots: 16, min: 1, reserve: 1, bound: 60 },
      records: { slots: 1, reserve: 0.125, bound: 60 },
      format: { slots: 1, reserve: 3, after: ["records"], bound: 60 },
    },
    times: "integrity\t100\t800\t8\nformat\t100\t50\t1\nrecords\t100\t1\t1\n",
    before: (_own,memory) => {
      assert.equal(writeCaseHistory(caseHistoryFile('integrity',memory),[
        {key:caseMemoryKey({step:'integrity',backend:'',path:'@step'}),peak:peakFor(GiB)},
      ]),undefined);
    },
    payload: `
own=$2 gate=$(dirname "$0")
case $1 in
  integrity)
    work() {
      until [ -e "$own/format-ran" ]; do
        bash "$gate/token.sh" --step -- node -e 'require("node:fs").writeFileSync(process.argv[1] + "/case-ran", "")' "$own" || exit 1
      done
    }
    pids=
    for worker in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do work & pids="$pids $!"; done
    for pid in $pids; do wait "$pid" || exit 1; done ;;
  records) exec node "$gate/until.mjs" "$own/case-ran" ;;
  format) : > "$own/format-ran" ;;
esac
` });
  assert.equal(result.status, 0, output);
  assert.equal(summary.verdict, "green");
  assert.ok(summary.memory.peak_bytes < 7 * GiB, `format's 3 GiB came from tokens returned, not beside four of them: ${summary.memory.peak_bytes}`);
});

// A later neighbour waits for the admitted run's next step to finish, then
// receives its memory. Readiness files establish the order without deadlines.
const NEIGHBOUR = `import { existsSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
const [ledger, observations, own, module] = process.argv.slice(1);
const { reserve } = await import(module);
const until = (dir, ready) => new Promise(resolve => { const watcher = watch(dir, () => { if (ready()) { watcher.close(); resolve(); } }); if (ready()) { watcher.close(); resolve(); } });
await until(own, () => existsSync(join(own, "ask")));
let last,reported=false;
const publish=()=>{if(last && !reported && existsSync(join(own,'handoff-ready'))){reported=true;writeFileSync(join(own,'neighbour-decided'),String(last.admitted));}};
const asked = reserve({ bytes: 6 * 2 ** 30, what: "neighbour" }, { env: { NTS_HOST_OBSERVATIONS: observations, NTS_MEMORY_LEDGER: ledger }, everyMs: 50,
  observe: decision=>{last=decision;publish();} });
asked.catch(()=>writeFileSync(join(own,'neighbour-decided'),'instrument failed'));
await until(own,()=>existsSync(join(own,'handoff-ready')));
// A cached admission still owns its memory. A cached refusal must instead
// wait for a fresh decision made after the runner reached the handoff.
if(last?.admitted)publish();
const held=await asked;
if (!existsSync(join(own, "records-ran"))) throw new Error("later neighbour ran before the admitted run's next step");
held.release();
`;

for(const arm of ['before','after'] as const)test(`an admitted run grows before a later neighbour at the forced handoff (${arm})`, async t => {
  // 10 GiB available, 2 kept for the system. The run holds 3 for format,
  // which blocks the later neighbour's 6. Records then needs 8: growth keeps
  // the run's admission place and takes exactly what is available. The
  // neighbour receives its 6 once the admitted work releases its promise.
  let neighbour: ReturnType<typeof spawn> | undefined;
  let neighbourClosed:Promise<unknown[]>|undefined,neighbourOutput='';
  t.after(() => { if (neighbour && neighbour.exitCode === null && neighbour.signalCode === null) neighbour.kill("SIGKILL"); });
  const { result, summary, output } = memoryRun(t, {
    steps: "format records", availableKiB: 10 * 2 ** 20,handoffBarrier:arm,
    rows: { format: { slots: 1, reserve: 3, bound: 60 }, records: { slots: 1, reserve: 8, after: ["format"], bound: 60 } },
    times: "format\t100\t200\t1\nrecords\t100\t100\t1\n",
    payload: `
case $1 in
  format) : > "$2/ask"; exec node "$(dirname "$0")/until.mjs" "$2/memory/ledger/waiting" --entry ;;
  records) : > "$2/records-ran" ;;
esac
`,
    before: (own, memory) => {
      const env: NodeJS.ProcessEnv = { ...fixtureEnvironment(t) };
      delete env.NTS_MEMORY_RESERVATION;
      neighbour = spawn(process.execPath, ["--input-type=module", "-e", NEIGHBOUR, memory.NTS_MEMORY_LEDGER, memory.NTS_HOST_OBSERVATIONS, own,
        pathToFileURL(fileURLToPath(new URL("./memory-ledger.ts", import.meta.url))).href], { env, stdio: ['ignore','pipe','pipe'] });
      neighbour.stdout!.on('data',part=>neighbourOutput+=String(part));neighbour.stderr!.on('data',part=>neighbourOutput+=String(part));
      neighbourClosed=once(neighbour,'close');
    },
  });
  assert.equal(result.status, 0, output);
  assert.equal(summary.verdict, "green");
  assert.equal(summary.memory.peak_bytes,8*GiB);
  assert.deepEqual(await neighbourClosed,[arm==='before'?1:0,null],neighbourOutput);
  if(arm==='before')assert.match(neighbourOutput,/later neighbour ran before the admitted run's next step/,'the retained before control fails for the handoff ordering');
  else assert.doesNotMatch(neighbourOutput,/later neighbour ran before/);
  t.diagnostic(JSON.stringify({arm,neighbour:arm==='before'?'admitted inside the unprotected handoff':'blocked until records completed'}));
});

// The landing check in the run's ledger: once the run's reservation has grown
// to 4 GiB, another landing job reserves 3.5 beside it, and the landing check
// asks for 2 at landing priority; once the run has given memory back, the
// other job ends. It says how its request went, and gives the memory back.
const LANDING = `import { existsSync, mkdirSync, readdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
const [ledger, observations, own, module] = process.argv.slice(1);
const { reserve } = await import(module);
const until = (dir, ready) => new Promise(resolve => { const watcher = watch(dir, () => { if (ready()) { watcher.close(); resolve(); } }); if (ready()) { watcher.close(); resolve(); } });
const admitted = join(ledger, "admitted");
mkdirSync(admitted, { recursive: true });
const run = test => () => readdirSync(admitted).some(name => {
  try { const entry = JSON.parse(readFileSync(join(admitted, name), "utf8")); return entry.what.startsWith("gate run ") && test(entry.bytes); } catch { return false; }
});
const options = { env: { NTS_HOST_OBSERVATIONS: observations, NTS_MEMORY_LEDGER: ledger }, everyMs: 50 };
await until(admitted, run(bytes => bytes >= 4 * 2 ** 30));
const other = await reserve({ bytes: 3.5 * 2 ** 30, what: "another landing job", priority: "landing" }, options);
const lines = [];
const asked = reserve({ bytes: 2 * 2 ** 30, what: "landing", priority: "landing" }, { ...options, report: line => lines.push(line) });
await until(own, () => existsSync(join(own,"yield-observed")));
await until(admitted, run(bytes => bytes < 4 * 2 ** 30));
other.release();
const held = await asked;
writeFileSync(join(own, "landing-admitted"), lines.join("\\n") + "\\n");
held.release();
`;

test("a run outranked by a request of higher priority starts nothing new and gives back what it does not use, then goes on", async t => {
  // A full-check run whose eight integrity workers take a 1 GiB token the
  // moment one comes back fills its reservation: 4 GiB, all the reading's
  // 6.5 allow beside the 2 kept for the system. Another landing job's 3.5 are
  // admitted beside them all the same, since the run promises a request that
  // outranks it only what it uses and a margin (memory-ledger.ts); the
  // landing check's 2 do not fit beside that job, and wait. Outranked, the
  // run grants no token as its cases end and gives their memory back; once
  // it has, the other job ends, the landing check is admitted, and integrity
  // goes on, each worker taking one more token before it ends.
  let landing: ReturnType<typeof spawn> | undefined, fixture = "";
  t.after(() => { if (landing && landing.exitCode === null && landing.signalCode === null) landing.kill("SIGKILL"); });
  const { result, summary, output } = memoryRun(t, {
    steps: "integrity", availableKiB: 6.5 * 2 ** 20, priority: "full-check", acknowledgeYield: true,
    rows: { integrity: { elastic: true, slots: 8, min: 1, reserve: 1, bound: 60 } },
    times: "integrity\t100\t800\t8\n",
    payload: `
own=$2 gate=$(dirname "$0")
case $1 in
  integrity)
    work() {
      until [ -e "$own/landing-admitted" ]; do
        bash "$gate/token.sh" --step -- node -e 0 || exit 1
      done
      bash "$gate/token.sh" --step -- node -e 0
    }
    pids=
    for worker in 1 2 3 4 5 6 7 8; do work & pids="$pids $!"; done
    for pid in $pids; do wait "$pid" || exit 1; done ;;
esac
`,
    before: (own, memory) => {
      fixture = own;
      assert.equal(writeCaseHistory(caseHistoryFile('integrity',memory),[
        {key:caseMemoryKey({step:'integrity',backend:'',path:'@step'}),peak:peakFor(GiB)},
      ]),undefined);
      const env: NodeJS.ProcessEnv = { ...fixtureEnvironment(t) };
      delete env.NTS_MEMORY_RESERVATION;
      landing = spawn(process.execPath, ["--input-type=module", "-e", LANDING, memory.NTS_MEMORY_LEDGER, memory.NTS_HOST_OBSERVATIONS, own,
        pathToFileURL(fileURLToPath(new URL("./memory-ledger.ts", import.meta.url))).href], { env, stdio: "inherit" });
    },
  });
  assert.equal(result.status, 0, output);
  assert.equal(summary.verdict, "green");
  assert.deepEqual(await once(landing!, "exit"), [0, null], "the landing check had its memory and gave it back");
  // The wait the ledger reports to the landing check: the run's look at the
  // queue, once a second, and its give-back.
  const told = readFileSync(join(fixture, "landing-admitted"), "utf8");
  assert.match(told, /^memory: landing waits for 2\.0 GiB \(landing\): /m);
  assert.match(told, /^memory: landing admitted with 2\.0 GiB after \d+ s$/m);
  assert.match(output, /memory: a request of higher priority than the run's waits in the ledger: the run starts nothing new and gives back what it does not use/);
  assert.match(output, /memory: no request of higher priority waits any more: the run goes on after \d+ s/);
  assert.ok(summary.memory.outranked >= 1 && summary.memory.shrinks >= 1, JSON.stringify(summary.memory));
  assert.equal(summary.memory.priority, "full-check");
});

test("a step's charged peak sizes its next run, and a step that held more than it reserved is over", t => {
  // format reserves 128 MiB and holds 300: a child it started holds them as
  // its main process ends, and the run samples what still runs then. records,
  // never measured here, reserves the largest of its kind, and copies the
  // run's ledger entry while the run holds it.
  const { result, summary, step, output, history, canonical } = memoryRun(t, {
    liveResident:true, steps: "format records", availableKiB: 16 * 2 ** 20,
    rows: { format: { slots: 1, reserve: 0.125, bound: 120 }, records: { slots: 1, after: ["format"], bound: 120 } },
    times: "format\t100\t200\t1\nrecords\t100\t100\t1\n",
    payload: `
own=$2
case $1 in
  format)
    python3 -c 'import signal, sys; held = bytes([1]) * (300 * 2 ** 20); open(sys.argv[1], "w").close(); signal.pause()' "$own/held" &
    exec node "$(dirname "$0")/until.mjs" "$own/held" ;;
  records) cat "$NTS_MEMORY_LEDGER/admitted/$NTS_MEMORY_RESERVATION.json" > "$own/entry.json" ;;
esac
` });
  assert.equal(result.status, 0, output);
  assert.equal(summary.verdict, "green", "a step over its reservation is told, never failed");
  const format = step("format"), records = step("records");
  assert.ok(format.memory.peak_bytes! >= 300 * MiB, `format's peak, on the ledger's basis: ${format.memory.peak_bytes}`);
  assert.deepEqual([format.memory.reserved_bytes, format.memory.over, format.memory.basis], [128 * MiB, true, "measured"]);
  assert.deepEqual([records.memory.reserved_bytes, records.memory.over, records.memory.basis], [128 * MiB, false, "largest"]);
  assert.match(output, /memory(?:\x1b\[0m)?: format held \d+\.\d MiB, past its 128\.0 MiB reservation/);
  assert.match(output, /OVER +format +held/);
  assert.deepEqual([summary.memory.over, summary.memory.unmeasured], [["format"], ["records"]]);
  const entry = JSON.parse(readFileSync(join(dirname(history), "../../entry.json"), "utf8")) as { what: string; unmeasured?: string[] };
  assert.match(entry.what, /^gate run /);
  assert.deepEqual(entry.unmeasured, ["records"], "the run's entry names the steps it sized without a measurement");
  if (!canonical) return;
  // The next run in this target reserves by what this one held.
  const kept = readCostHistory(history).steps.get("format")!.memory!;
  assert.equal(kept.peaks.length, 2);
  assert.equal(kept.peaks[1], format.memory.peak_bytes);
  assert.ok(peakReservation(kept.peaks) >= 375 * MiB, `${peakReservation(kept.peaks)}`);
  assert.equal(readCostHistory(history).steps.get("records")!.memory!.unit, "step", "records is measured now");
});

test("a narrow census step with no history passes a case that needs more than its share but fits one worker's own cap", t => {
  // A 3 GiB machine, 2 of them kept for the system, and ten slots: one
  // slot's share of the 1 GiB the ledger can give is 102 MiB, and with
  // nothing measured format reserves that, so twice its reservation is 205.
  // Its one case, run alone as a serial census case, holds 750 MiB, which
  // fits a worker's own 1 GiB cap: the census aggregate is never below that
  // cap, so the case passes here as in a tree whose history knew it.
  const { result, summary, step, output } = memoryRun(t, {
    liveResident:true, steps: "format", availableKiB: 3 * 2 ** 20, totalKiB: 3 * 2 ** 20,
    acknowledgeCharge: 700 * MiB,
    rows: { format: { slots: 1, bound: 300 } },
    owned: { NTS_CENSUS_MEMORY_CAP_KB: String(2 ** 20) },
    times: "format\t100\t20\t1\n",
    payload: `
case $1 in
  format) exec node "$(dirname "$0")/census-case.ts" ;;
esac
`,
    before: own => {
      const fifo = join(own, "charge-observed");
      assert.equal(spawnTest("mkfifo", [fifo], { encoding: "utf8" }).status, 0);
      writeFileSync(join(own, "repo/tooling/gate/census-case.ts"), `import { compileSync, serialRun } from ${JSON.stringify(new URL("../census/worker-memory.ts", import.meta.url).href)};
const cap = Number(process.env.NTS_CENSUS_MEMORY_CAP_KB);
await serialRun({ memoryCapKb: cap });
const held = compileSync({ memoryCapKb: cap }, "python3", ["-c", "import sys; held = bytes([1]) * (750 * 2 ** 20); open(sys.argv[1]).read(); print(len(held))", ${JSON.stringify(fifo)}], { encoding: "utf8" });
if (held.status !== 0 || held.memoryKilled) throw new Error("the case did not run to its end: " + held.stderr);
`);
    },
  });
  assert.equal(result.status, 0, output);
  assert.equal(summary.verdict, "green", JSON.stringify(step("format")));
  const format = step("format");
  assert.equal(format.memory.basis, "share");
  assert.equal(format.memory.reserved_bytes, Math.floor(GiB / 10));
  assert.equal(format.memory.over, true, "it held more than its share, and its next run reserves by it");
});

test("an unmeasured step reserves at most the widest step's share, half of what the ledger can give", t => {
  // 32 GiB, 30 of them the ledger can give, and ten slots: an unmeasured
  // eight-slot step's share would be 24 GiB; it reserves 15.
  const { result, summary, step, output } = memoryRun(t, {
    steps: "format", availableKiB: 20 * 2 ** 20,
    rows: { format: { slots: 8, min: 1, bound: 60 } },
    times: "format\t100\t20\t1\n",
    payload: ":\n",
  });
  assert.equal(result.status, 0, output);
  assert.equal(summary.verdict, "green");
  assert.deepEqual([step("format").memory.reserved_bytes, step("format").memory.basis], [15 * GiB, "share"]);
});

// A step's slice bounds only a runaway, and its grant grows while it runs, for
// the ledger's accounting (run.mjs, "Memory"). Each fake step below fills real
// memory, so each test's sizes are small; the kernel enforces every bound.
const fill = (gibibytes: number, chunks: number) => `exec node -e 'const held = []; for (let i = 0; i < ${chunks}; i++) held.push(Buffer.alloc(Math.round(${gibibytes} * 2 ** 30 / ${chunks}), 1)); console.log(held.length)'`;

for (const priority of ["landing", "agent", "full-check"] as const) test(`a ${priority} run carries its OOM score into its production step scope`, t => {
  // Start at the manager's floor even inside a full-check test process, so
  // each real runner must apply its own priority before launching its scope.
  const { result, summary, step, output } = memoryRun(t, {
    steps: "format", priority, oomScore: OOM_SCORE.landing, availableKiB: 16 * 2 ** 20,
    rows: { format: { slots: 1, reserve: 0.25, bound: 120 } },
    times: "format\t100\t20\t1\n",
    payload: 'echo "oom_score_adj $(cat /proc/self/oom_score_adj)"\n',
  });
  assert.equal(result.status, 0, output);
  assert.equal(summary.memory.priority, priority);
  assert.equal(step("format").verdict, "PASS", output);
  assert.equal(Number(/^oom_score_adj (\d+)$/m.exec(readFileSync(step("format").log, "utf8"))?.[1]), OOM_SCORE[priority]);
});

test("a step that fills past its grant, under its runaway bound, is never throttled and passes, its grant grown for the ledger", t => {
  // format reserves 256 MiB, as its history says, and fills 1 GiB at once:
  // under the 1.25 GiB runaway bound of its grant nothing holds it, and the
  // run grows its grant from the reservation's slack, then by a growth of
  // the reservation. Its processes carry the run's agent OOM score, or the
  // higher one this test inherited: a score is only ever raised, so inside
  // the full check's unit (500) the run keeps 500.
  const inherited = Number(readFileSync("/proc/self/oom_score_adj", "utf8"));
  const { result, summary, step, output } = memoryRun(t, {
    liveResident:true, acknowledgeCharge:GiB, steps: "format", availableKiB: 16 * 2 ** 20,
    rows: { format: { slots: 1, reserve: 0.25, bound: 120 } },
    times: "format\t100\t20\t1\n",
    before:own=>{assert.equal(spawnTest("mkfifo",[join(own,"charge-observed")],{encoding:"utf8"}).status,0);},
    payload: `\ncase $1 in\n  format) echo "oom_score_adj $(cat /proc/self/oom_score_adj)"; exec node -e 'const fs=require("node:fs"),held=Buffer.alloc(2**30,1);fs.readFileSync(process.argv[1]);console.log(held.length)' "$2/charge-observed" ;;\nesac\n`,
  });
  assert.equal(result.status, 0, output);
  const format = step("format");
  assert.equal(format.verdict, "PASS", JSON.stringify(format));
  assert.ok(format.memory.grown_bytes > 0 && format.memory.grant_bytes > format.memory.reserved_bytes, JSON.stringify(format.memory));
  assert.ok(format.memory.bound_bytes >= 1.25 * GiB, JSON.stringify(format.memory));
  assert.equal(format.memory.killed, 0);
  assert.equal(summary.memory.steps_grown, 1);
  assert.match(output, /-- format: memory grown by .* to .* \(charge /);
  assert.equal(Number(/^oom_score_adj (\d+)$/m.exec(readFileSync(format.log, "utf8"))?.[1]), Math.max(inherited, OOM_SCORE.agent));
});

test("a step past its runaway bound is killed there and held as memory pressure, never a FAIL", t => {
  // A 3 GiB machine, 2 kept for the system: the run can hold 1 GiB at most,
  // so no step's bound is above it. format fills 2 GiB at once and the
  // kernel kills it at its bound.
  const { result, summary, step, output } = memoryRun(t, {
    liveResident:true, steps: "format", availableKiB: 3 * 2 ** 20, totalKiB: 3 * 2 ** 20,
    rows: { format: { slots: 1, reserve: 0.25, bound: 120 } },
    times: "format\t100\t20\t1\n",
    payload: `\ncase $1 in\n  format) ${fill(2, 1)} ;;\nesac\n`,
  });
  assert.notEqual(result.status, 0, output);
  const format = step("format");
  assert.equal(format.verdict, "INSTRUMENT", JSON.stringify(format));
  assert.equal(format.instrument?.kind, "memory-pressure");
  assert.match(format.reason ?? "", /^memory: the kernel killed \d+ process\(es\) of the step at its runaway bound of 1\.0 GiB/);
  assert.ok(format.memory.killed > 0, JSON.stringify(format.memory));
  assert.equal(summary.memory.steps_killed, 1);
  assert.notEqual(summary.verdict, "green");
});
test("an elastic step's held tokens are its unit's alone exactly as before sizes, and each sized one counts at its size", () => {
  for (const unit of [1, 268435456, 2537553920]) for (let tokens = 0; tokens <= 6; tokens++) {
    assert.ok(Object.is(elasticHeldBytes(tokens, undefined, unit), tokens * unit), `${tokens} of ${unit}`);
    assert.ok(Object.is(elasticHeldBytes(tokens, { count: 0, bytes: 0 }, unit), tokens * unit));
  }
  assert.equal(elasticHeldBytes(3, { count: 2, bytes: 300 * MiB }, GiB), GiB + 300 * MiB);
});

test("a case's peaks are kept, by its key, and it reserves as a unit does; a case never measured reserves nothing of its own", t => {
  const own = testScratch(t, "case-history"), env = { NTS_GATE_COSTS_DIR: join(own, "costs") };
  mkdirSync(env.NTS_GATE_COSTS_DIR);
  const file = caseHistoryFile("program-oracles", env);
  const key=(path:string)=>caseMemoryKey({step:'program-oracles',backend:'node',path});
  assert.equal(file, join(own, "costs", "cases-v2", "program-oracles.json"));
  assert.equal(readCaseHistory(file).size, 0);
  for (let run = 1; run <= KEPT_PEAKS + 1; run++)
    assert.equal(writeCaseHistory(file, [{ key: key("benchmarks/cases/heavy"), peak: run * GiB }, { key: key("tests/programs/light"), peak: 140 * MiB }]), undefined);
  const history = readCaseHistory(file);
  assert.deepEqual(history.get(key("benchmarks/cases/heavy")), Array.from({ length: KEPT_PEAKS }, (_, i) => (i + 2) * GiB), "the last few, oldest first");
  assert.equal(caseReservation(history,key("benchmarks/cases/heavy")), peakReservation([(KEPT_PEAKS + 1) * GiB]));
  assert.equal(caseReservation(history,key("tests/programs/light")), peakReservation([140 * MiB]));
  assert.equal(caseReservation(history,key("tests/programs/new")), undefined);
  assert.equal(JSON.parse(readFileSync(file,'utf8')).version,2);
  writeFileSync(file, '{"version":1,"cases":{"x":[-1]}}');
  assert.equal(readCaseHistory(file).size, 0, "a corrupt history is an empty one");
});

test('version-one oracle subject history migrates to composite keys and retains converging measured peaks',t=>{
  const root=testScratch(t,'case-history-migration'),file=join(root,'program-oracles.json'),subject='tests/programs/example';
  const key=caseMemoryKey({step:'program-oracles',backend:'node',path:subject});
  writeFileSync(file,JSON.stringify({version:1,cases:{[subject]:[600*MiB],[key]:[300*MiB]}}));
  const history=readCaseHistory(file);
  assert.equal(history.has(subject),false);assert.deepEqual(history.get(key),[300*MiB,600*MiB]);
  assert.equal(caseReservation(history,key),peakReservation([600*MiB]));
  assert.equal(writeCaseHistory(file,[{key,peak:400*MiB}]),undefined);
  const recorded=JSON.parse(readFileSync(file,'utf8'));
  assert.equal(recorded.version,2);assert.deepEqual(Object.keys(recorded.cases),[key]);
  assert.deepEqual(readCaseHistory(file).get(key),[300*MiB,600*MiB,400*MiB]);
  assert.equal(caseReservation(readCaseHistory(file),key),peakReservation([600*MiB]));
});

test('an older writer cannot overwrite the version-two case history namespace',t=>{
  const root=testScratch(t,'case-history-old-writer'),env={NTS_GATE_COSTS_DIR:root};
  const file=caseHistoryFile('program-oracles',env),legacy=join(root,'cases','program-oracles.json');
  const subject='tests/programs/example',key=caseMemoryKey({step:'program-oracles',backend:'node',path:subject});
  mkdirSync(dirname(legacy));
  const old=JSON.stringify({version:1,cases:{[subject]:[600*MiB]}})+'\n';writeFileSync(legacy,old);
  assert.deepEqual(readCaseHistory(file).get(key),[600*MiB]);
  assert.equal(writeCaseHistory(file,[{key,peak:400*MiB}]),undefined);
  assert.equal(readFileSync(legacy,'utf8'),old,'the migration leaves the old candidate its own file');
  writeFileSync(legacy,JSON.stringify({version:1,cases:{[subject]:[100*MiB]}}));
  assert.deepEqual(readCaseHistory(file).get(key),[600*MiB,400*MiB]);
  writeFileSync(file,'invalid');
  assert.equal(readCaseHistory(file).size,0,'a present v2 file never falls back to stale v1');
});

test("a sized token is answered once its step's slice can hold it: its runaway bound follows its held tokens' sizes", t => {
  // integrity's unit is 256 MiB; its worker asks for a 1 GiB token and then a
  // 512 MiB one, and reads its slice's MemoryMax as each is answered.
  const tokens = new URL("./tokens.mjs", import.meta.url).href;
  let fixture = "";
  const { result, step, output } = memoryRun(t, {
    steps: "integrity", availableKiB: 16 * 2 ** 20,
    rows: { integrity: { elastic: true, slots: 2, min: 1, reserve: 0.25, bound: 60 } },
    times: "integrity\t100\t20\t2\n",
    before: (own,memory) => {
      fixture = own;
      assert.equal(writeCaseHistory(caseHistoryFile('integrity',memory),[
        {key:caseMemoryKey({step:'integrity',backend:'',path:'tests/fixture/first'}),peak:peakFor(GiB)},
        {key:caseMemoryKey({step:'integrity',backend:'',path:'tests/fixture/second'}),peak:peakFor(GiB/2)},
      ]),undefined);
    },
    payload: `
case $1 in
  integrity) exec node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const { acquireToken } = await import(process.argv[1]);
const slice = join("/sys/fs/cgroup", dirname(readFileSync("/proc/self/cgroup", "utf8").trim().replace(/^0::/, "")));
const high = () => Number(readFileSync(join(slice, "memory.max"), "utf8"));
const first = await acquireToken({project:"tests/fixture/first"}), atFirst = high();
const second = await acquireToken({project:"tests/fixture/second"}), atSecond = high();
writeFileSync(process.argv[2] + "/highs.json", JSON.stringify([atFirst, atSecond]));
first(); second();
' ${JSON.stringify(tokens)} "$2" ;;
esac
`,
  });
  assert.equal(result.status, 0, output);
  assert.equal(step("integrity").verdict, "PASS", output);
  const [atFirst, atSecond] = JSON.parse(readFileSync(join(fixture, "highs.json"), "utf8")) as [number, number];
  // The runaway bound of a grant: the grant and a block or a quarter of it,
  // or twice what it was measured to hold, whichever is more.
  const bound = (grant: number) => Math.max(grant + Math.max(GiB, grant / 4), 2 * grant / RESERVATION_PER_PEAK);
  assert.equal(atFirst, bound(GiB), `its 1 GiB token's bound at its answer, not its 256 MiB unit's: ${atFirst}`);
  assert.equal(atSecond, bound(1.5 * GiB), `both its tokens' sizes: ${atSecond}`);
});


test('the CPU instrument migration keeps memory peaks but resets legacy CPU and summary seeds',t=>{
  const root=testScratch(t,'cpu-epoch'),file=join(root,'steps.json'),summary=join(root,'summary.json');
  const memory={unit:'step',peaks:[1000]};
  writeFileSync(file,JSON.stringify({version:3,steps:{tests:{cpu:0.17,memory}},jobs:{probe:{unit:'worker',peaks:[500]}}}));
  assert.deepEqual(readCostHistory(file).steps.get('tests'),{memory});
  assert.equal(readCostHistory(file).jobs.has('probe'),false,'legacy jobs have no recoverable width or sizing basis');
  writeFileSync(summary,JSON.stringify({schema:1,environment:{canonical:true},steps:[{name:'tests',verdict:'PASS',cpu:0.17,cpu_measure:GNU_CPU_MEASURE}]}));
  assert.equal(readPreviousStepCpu(summary).size,0);
  assert.equal(writeCostHistory(file,{steps:[{name:'tests',verdict:'PASS',cpu:9,cpu_measure:GNU_CPU_MEASURE}]}),undefined);
  assert.equal(stepCpu(readCostHistory(file)).size,0);
  assert.equal(writeCostHistory(file,{steps:[{name:'tests',verdict:'PASS',cpu:4,cpu_measure:STEP_CPU_MEASURE}]}),undefined);
  assert.equal(stepCpu(readCostHistory(file)).get('tests'),4);
  assert.deepEqual(readCostHistory(file).steps.get('tests')!.memory,memory);
  assert.equal(JSON.parse(readFileSync(file,'utf8')).version,COST_HISTORY_VERSION);
});

test('the runner never classifies an accounting switch as a CPU regression',t=>{
  for(const measure of [GNU_CPU_MEASURE,STEP_CPU_MEASURE]){
    const {result,summary,output}=memoryRun(t,{steps:'format',availableKiB:16*2**20,
      rows:{format:{slots:1,reserve:1,bound:60}},times:`format\t100\t1\t1\t${measure}\n`,payload:'exit 0',owned:{NTS_GATE_TIME_STRICT:'1'},
      before:(_own,memory)=>{const packet=JSON.parse(readFileSync(memory.NTS_HOST_OBSERVATIONS,'utf8'));packet.cpu={kind:'fixed',default:{usageUsec:100_000_000,userUsec:90_000_000,systemUsec:10_000_000}};writeFileSync(memory.NTS_HOST_OBSERVATIONS,JSON.stringify(packet));}});
    assert.equal(result.status,measure===STEP_CPU_MEASURE?1:0,output);
    assert.equal(summary.verdict,measure===STEP_CPU_MEASURE?'red':'green');
  }
});
