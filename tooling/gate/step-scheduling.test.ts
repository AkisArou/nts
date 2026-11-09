import assert from "node:assert/strict";
import {moduleClosure} from "./module-closure-fixture.ts";
import {oracleWorkspaceFixture} from "../differential/oracle-workspace-fixture.ts";
import {test} from "node:test";
import {copyFileSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync} from "node:fs";
import {join, dirname} from "node:path";

import {fileURLToPath, pathToFileURL} from "node:url";
import {gateEnvironment, hostEnvironment} from "./canonical-environment.ts";
import {removable} from "./run-temporary.ts";
import {spawnTest} from "./test-wait.ts";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {inheritedStepWork, orderStepStarts, readPreviousStepCpu, readStepCpuHistory, usableWidth, writeStepCpuHistory} from "./step-scheduling.ts";
import {testScratch, newTestScratch} from "./test-scratch.ts";
import {ownMemory, type OwnMemory} from "./test-memory.ts";

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
    { name: "typescript-c", verdict: "PASS", wall: 1067, cpu: 2663 }, { name: "blockers", verdict: "NOT RUN", wall: 900, cpu: 900 },
  ] }));
  const seed = readPreviousStepCpu(previous);
  assert.deepEqual([...seed], [["typescript-c", 2663]]);
  assert.equal(writeStepCpuHistory(file, [{ name: "rustfmt", verdict: "PASS", cpu: 2 }], seed), undefined);
  assert.deepEqual([...readStepCpuHistory(file)], [["rustfmt", 2], ["typescript-c", 2663]]);
  assert.equal(writeStepCpuHistory(file, [{ name: "typescript-c", verdict: "PASS", cpu: 600 },
    { name: "blockers", verdict: "FAIL", cpu: 1 }]), undefined);
  assert.deepEqual([...readStepCpuHistory(file)], [["rustfmt", 2], ["typescript-c", 600]]);
  writeFileSync(file, JSON.stringify({ version: 1, steps: { "typescript-c": 1067 } }));
  assert.equal(readStepCpuHistory(file).size, 0, "a wall-time history from before is not read as work");
  writeFileSync(file, "partial{"); assert.equal(readStepCpuHistory(file).size, 0);
  const blocked = join(own, "not-a-directory"); writeFileSync(blocked, "preserve");
  assert.equal(typeof writeStepCpuHistory(join(blocked, "steps.json"), []), "string");
  assert.equal(readFileSync(blocked, "utf8"), "preserve");
  writeFileSync(previous, JSON.stringify({ schema: 1, environment: { canonical: false }, steps: [
    { name: "typescript-c", verdict: "PASS", cpu: 1 },
  ] }));
  assert.equal(readPreviousStepCpu(previous).size, 0);
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
  const baseline = "tests\t900\t10000\t8\ntypescript-c\t1\t1\t8\ntypescript-oracles\t1\t1\t8\n";
  writeFileSync(join(gate, "times.tsv"), baseline);
  writeFileSync(join(target, "gate-costs/steps.json"), JSON.stringify({ version: 2, steps: { tests: 100, "typescript-c": 8000, "typescript-oracles": 16000 } }) + "\n");
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
    ...ownMemory(join(own, "memory")), CARGO_TARGET_DIR: target, NTS_BIN: compiler,
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
  const history = JSON.parse(readFileSync(join(target, "gate-costs/steps.json"), "utf8")) as { version: number; steps: Record<string, number> };
  assert.equal(history.version, 2);
  // Only a canonical run writes the history (run.mjs); this test's run is
  // canonical alone and not inside a gate, whose variables make it an experiment.
  const measured = summary.steps.find(step => step.name === "typescript-c")?.cpu;
  const written = summary.environment?.canonical === true && typeof measured === "number" && measured > 0;
  assert.equal(history.steps["typescript-c"], written ? measured : 8000,
    "a canonical run records the step's measured CPU; any other run leaves the history as it was");
});

const GiB = 2 ** 30;
type MemoryRow = { slots: number; min?: number; mem: number; elastic?: boolean; after?: string[]; bound: number };
type MemoryStep = { name: string; verdict: string; started_at: string; wall: number; memory_peak_bytes: number | null };

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
  /** The run's place in the ledger's queue, as its launcher's code gives it. */
  priority?: "landing" | "agent" | "full-check";
  /** Runs before the runner starts, with the fixture's directory and memory. */
  before?: (own: string, memory: OwnMemory) => void;
};

/**
 * A real runner over `steps` in a scratch repository: the real step table with
 * `rows` in place of those steps' own, every step running `payload`, on a
 * 32 GiB machine with `availableKiB` of it available, read from a file the
 * test writes, and a memory ledger of the run's own.
 */
function memoryRun(t: { after: (fn: () => void) => void }, { steps, rows, times, payload, availableKiB, priority, before }: MemoryFixture) {
  const own = newTestScratch("step-scheduling-memory");
  t.after(() => { removable(own); rmSync(own, { recursive: true, force: true }); });
  const root = join(own, "repo"), gate = join(root, "tooling/gate"), target = join(own, "target"), run = join(own, "home/.cache/gate-run");
  mkdirSync(gate, { recursive: true }); mkdirSync(join(target, "gate-costs"), { recursive: true });
  const source = fileURLToPath(new URL("./", import.meta.url));
  for (const name of moduleClosure(["tooling/gate/run.mjs"])) {
    const destination = join(root, name), original = join(source, "../..", name);
    mkdirSync(dirname(destination), { recursive: true });
    if (name === "tooling/gate/run.mjs") writeFileSync(destination, readFileSync(original));
    else if (name === "tooling/gate/step-table.mjs") {
      writeFileSync(destination, `import { STEPS as REAL, stepTableProblem } from ${JSON.stringify(pathToFileURL(original).href)};
const rows = ${JSON.stringify(rows)};
export const STEPS = REAL.map(row => Object.hasOwn(rows, row.name) ? { name: row.name, ...rows[row.name] } : row);
export { stepTableProblem };
`);
    } else symlinkSync(original, destination);
  }
  symlinkSync(join(source, "token.sh"), join(gate, "token.sh"));
  writeFileSync(join(gate, "times.tsv"), times);
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
  const memory = ownMemory(join(own, "memory"), { availableKiB, totalKiB: 32 * 2 ** 20 });
  before?.(own, memory);
  const planned = gateEnvironment({ ...hostEnvironment(process.env), HOME: join(own, "home") }, { run, owned: {
    NTS_GATE_STEPS: steps, NTS_GATE_SLOTS: "10", ...memory, CARGO_TARGET_DIR: target, ...(priority ? { NTS_MEMORY_PRIORITY: priority } : {}),
  } });
  const result = spawnTest(process.execPath, [join(gate, "run.mjs")], { cwd: root, env: planned.env, encoding: "utf8" });
  const summary = JSON.parse(readFileSync(join(run, "summary.json"), "utf8")) as {
    verdict: string; steps: MemoryStep[]; memory: { priority: string; peak_bytes: number; growths: number; withdrawn: number; waited_s: number };
  };
  const step = (name: string) => summary.steps.find(row => row.name === name)!;
  return { result, summary, step, output: result.stdout + result.stderr };
}

test("steps whose memory together is more than the run can reserve run one after the other", t => {
  // 6.5 GiB available, 2 of them kept for the system: the run reserves 3 for
  // format and cannot grow by records' 3 more beside it.
  const { result, summary, step, output } = memoryRun(t, {
    steps: "format records", availableKiB: 6.5 * 2 ** 20,
    rows: { format: { slots: 1, mem: 3, bound: 60 }, records: { slots: 1, mem: 3, bound: 60 } },
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
      integrity: { elastic: true, slots: 16, min: 1, mem: 16, bound: 60 },
      records: { slots: 1, mem: 0.1, bound: 60 },
      format: { slots: 1, mem: 3, after: ["records"], bound: 60 },
    },
    times: "integrity\t100\t800\t8\nformat\t100\t50\t1\nrecords\t100\t1\t1\n",
    payload: `
own=$2 gate=$(dirname "$0")
case $1 in
  integrity)
    work() {
      until [ -e "$own/format-ran" ]; do
        bash "$gate/token.sh" node -e 'require("node:fs").writeFileSync(process.argv[1] + "/case-ran", "")' "$own" || exit 1
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

// A neighbour's job in the run's ledger: it asks for 6 GiB once the run's
// first step says so, and gives them back once the run waits to grow behind it.
const NEIGHBOUR = `import { existsSync, readdirSync, readFileSync, watch } from "node:fs";
import { join } from "node:path";
const [ledger, meminfo, own, module] = process.argv.slice(1);
const { reserve } = await import(module);
const until = (dir, ready) => new Promise(resolve => { const watcher = watch(dir, () => { if (ready()) { watcher.close(); resolve(); } }); if (ready()) { watcher.close(); resolve(); } });
const growing = () => readdirSync(join(ledger, "waiting")).some(name => {
  try { return name.endsWith(".json") && JSON.parse(readFileSync(join(ledger, "waiting", name), "utf8")).grows !== null; } catch { return false; }
});
await until(own, () => existsSync(join(own, "ask")));
const held = await reserve({ bytes: 6 * 2 ** 30, what: "neighbour" }, { env: { NTS_MEMINFO: meminfo, NTS_MEMORY_LEDGER: ledger }, everyMs: 50 });
await until(join(ledger, "waiting"), growing);
held.release();
`;

test("a run that waits to grow gives back what it does not use, so a request queued before its growth is not held by it", async t => {
  // 10 GiB available, 2 kept for the system. The run holds 3 for format, and
  // the neighbour's 6 do not fit beside them, so they wait. Then records needs
  // 8: the run gives back what it no longer uses beyond two blocks, which
  // lets the neighbour in ahead of the run's growth, and the growth follows
  // once the neighbour is done. Holding the 3 it does not use, the run would
  // wait behind a neighbour waiting for those 3, for ever.
  let neighbour: ReturnType<typeof spawn> | undefined;
  t.after(() => { if (neighbour && neighbour.exitCode === null && neighbour.signalCode === null) neighbour.kill("SIGKILL"); });
  const { result, summary, output } = memoryRun(t, {
    steps: "format records", availableKiB: 10 * 2 ** 20,
    rows: { format: { slots: 1, mem: 3, bound: 60 }, records: { slots: 1, mem: 8, after: ["format"], bound: 60 } },
    times: "format\t100\t200\t1\nrecords\t100\t100\t1\n",
    payload: `
case $1 in
  # Holding its memory, it lets the neighbour ask, and ends once the neighbour waits.
  format) : > "$2/ask"; exec node "$(dirname "$0")/until.mjs" "$2/memory/ledger/waiting" --entry ;;
esac
`,
    before: (own, memory) => {
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.NTS_MEMORY_RESERVATION;
      neighbour = spawn(process.execPath, ["--input-type=module", "-e", NEIGHBOUR, memory.NTS_MEMORY_LEDGER, memory.NTS_MEMINFO, own,
        pathToFileURL(fileURLToPath(new URL("./memory-ledger.ts", import.meta.url))).href], { env, stdio: "inherit" });
    },
  });
  assert.equal(result.status, 0, output);
  assert.equal(summary.verdict, "green");
  // Behind the neighbour's request, or after it if the neighbour's next look
  // came first: either way the neighbour had memory the run no longer used.
  assert.match(output, /memory: gate run .* waits to grow by 6\.0 GiB to 8\.0 GiB \(agent\)/);
  assert.ok(summary.memory.shrinks >= 1, JSON.stringify(summary.memory));
  assert.deepEqual(await once(neighbour!, "exit"), [0, null], "the neighbour had its memory and gave it back");
});

// The landing check's request in the run's ledger: once the run's reservation
// has grown to 4 GiB, it asks for 2 at landing priority, says when it is
// admitted, and gives them back.
const LANDING = `import { mkdirSync, readdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
const [ledger, meminfo, own, module] = process.argv.slice(1);
const { reserve } = await import(module);
const until = (dir, ready) => new Promise(resolve => { const watcher = watch(dir, () => { if (ready()) { watcher.close(); resolve(); } }); if (ready()) { watcher.close(); resolve(); } });
const admitted = join(ledger, "admitted");
mkdirSync(admitted, { recursive: true });
const full = () => readdirSync(admitted).some(name => {
  try { const entry = JSON.parse(readFileSync(join(admitted, name), "utf8")); return entry.what.startsWith("gate run ") && entry.bytes >= 4 * 2 ** 30; } catch { return false; }
});
await until(admitted, full);
const lines = [];
const held = await reserve({ bytes: 2 * 2 ** 30, what: "landing", priority: "landing" },
  { env: { NTS_MEMINFO: meminfo, NTS_MEMORY_LEDGER: ledger }, everyMs: 50, report: line => lines.push(line) });
writeFileSync(join(own, "landing-admitted"), lines.join("\\n") + "\\n");
held.release();
`;

test("a run outranked by a request of higher priority starts nothing new and gives back what it does not use, then goes on", async t => {
  // A full-check run whose eight integrity workers take a 1 GiB token the
  // moment one comes back fills its reservation: 4 GiB, all the reading's
  // 6.5 allow beside the 2 kept for the system. The landing check's 2 GiB do
  // not fit beside them. Outranked, the run grants no token as its cases end
  // and gives their memory back, so the landing check is admitted once a few
  // cases have ended; then integrity goes on, each worker taking one more
  // token before it ends.
  let landing: ReturnType<typeof spawn> | undefined, fixture = "";
  t.after(() => { if (landing && landing.exitCode === null && landing.signalCode === null) landing.kill("SIGKILL"); });
  const { result, summary, output } = memoryRun(t, {
    steps: "integrity", availableKiB: 6.5 * 2 ** 20, priority: "full-check",
    rows: { integrity: { elastic: true, slots: 8, min: 1, mem: 8, bound: 60 } },
    times: "integrity\t100\t800\t8\n",
    payload: `
own=$2 gate=$(dirname "$0")
case $1 in
  integrity)
    work() {
      until [ -e "$own/landing-admitted" ]; do
        bash "$gate/token.sh" node -e 0 || exit 1
      done
      bash "$gate/token.sh" node -e 0
    }
    pids=
    for worker in 1 2 3 4 5 6 7 8; do work & pids="$pids $!"; done
    for pid in $pids; do wait "$pid" || exit 1; done ;;
esac
`,
    before: (own, memory) => {
      fixture = own;
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.NTS_MEMORY_RESERVATION;
      landing = spawn(process.execPath, ["--input-type=module", "-e", LANDING, memory.NTS_MEMORY_LEDGER, memory.NTS_MEMINFO, own,
        pathToFileURL(fileURLToPath(new URL("./memory-ledger.ts", import.meta.url))).href], { env, stdio: "inherit" });
    },
  });
  assert.equal(result.status, 0, output);
  assert.equal(summary.verdict, "green");
  assert.deepEqual(await once(landing!, "exit"), [0, null], "the landing check had its memory and gave it back");
  // The wait the ledger reports to the landing check: the run's look at the
  // queue, once a second, and a few cases' time.
  const told = readFileSync(join(fixture, "landing-admitted"), "utf8");
  assert.match(told, /^memory: landing waits for 2\.0 GiB \(landing\): /m);
  const waited = Number(/^memory: landing admitted with 2\.0 GiB after (\d+) s$/m.exec(told)?.[1]);
  assert.ok(waited <= 5, `admitted after ${waited} s:\n${told}`);
  assert.match(output, /memory: a request of higher priority than the run's waits in the ledger: the run starts nothing new and gives back what it does not use/);
  assert.match(output, /memory: no request of higher priority waits any more: the run goes on after \d+ s/);
  assert.ok(summary.memory.outranked >= 1 && summary.memory.shrinks >= 1, JSON.stringify(summary.memory));
  assert.equal(summary.memory.priority, "full-check");
});
