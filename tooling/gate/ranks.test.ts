import {fixtureEnvironment} from "./test-environment.ts";
// The CPU ranks (ranks.ts): what each placement owner asks systemd for, and
// what the kernel then holds. The kernel controls run inside this test's own
// tooling slice (a gate step's, when the gate runs it), with a memory ledger
// and scheduling history of their own (AGENTS.md). They never start a
// weighted root under nts.slice: a root sits beside the machine's live runs,
// and a weighted one there would take CPU from them for the test's length. So
// the kernel controls start each rank's unit with the exact arguments its
// owner produces for a root's place (`toolingSliceArgs`, the landing
// service's properties), moved only into this test's slice; the root slice's
// own property list (`rankProperties`) and its refusal are checked purely.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { gateEnvironment } from "./canonical-environment.ts";
import { CPU_WEIGHT, OOM_SCORE, PRIORITIES, RANK_SLICE, type Priority } from "./ranks.ts";
import { rankedScopeArgs, rankProperties, rankRoot, startBoundSlice, underRankSlice } from "./scopes/bound-slice.ts";
import { cpuControls } from "./scopes/cpu-limits.ts";
import { scopeArgs } from "./affinity.ts";
import { startArgs } from "../agents/agents.ts";
import { GateScopes } from "./scopes/step-scope.ts";
import { readLedger } from "./memory-ledger.ts";
import { historyFile, readCostHistory } from "./step-scheduling.ts";
import { removable } from "./run-temporary.ts";
import { ownMemory } from "./test-memory.ts";
import { newTestScratch } from "./test-scratch.ts";
import { waitFor } from "./test-wait.ts";
import { stopToolingSlice, toolingSliceArgs } from "./tooling-slice.ts";
import { serviceArgs } from "../landing/queue.ts";
import { lowPriority } from "../full-check/unit.ts";

const ADMIT = fileURLToPath(new URL("./admit.ts", import.meta.url));
const MiB = 2 ** 20;
const AGENT_SHELL = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-1.scope\n";
const IN_A_RUN = "0::/user.slice/user-1000.slice/user@1000.service/nts.slice/nts-r12345678.slice/nts-r12345678-s23456789.slice/nts-s34567890.scope\n";

test("the ranks are ordered the same way for memory, the OOM killer and the CPU", () => {
  assert.deepEqual([...PRIORITIES], ["landing", "agent", "full-check"]);
  const weights = PRIORITIES.map(rank => CPU_WEIGHT[rank]), scores = PRIORITIES.map(rank => OOM_SCORE[rank]);
  assert.deepEqual(weights, [...weights].sort((a, b) => b - a), "a higher rank never weighs less");
  assert.deepEqual(scores, [...scores].sort((a, b) => a - b), "a higher rank is never killed first");
  assert.equal(CPU_WEIGHT.agent, 100, "an agent's weight is the kernel's default: unranked work ties with agents, never with a landing");
  for (const weight of weights) assert.ok(Number.isInteger(weight) && weight >= 1 && weight <= 10000, "cgroup v2 cpu.weight's range");
});

test("a unit outside any run goes among every rank's work at the rank its launcher names, and one inside a run joins the run", () => {
  for (const rank of PRIORITIES) assert.deepEqual(toolingSliceArgs({}, rank), [`--slice=${RANK_SLICE}`, `--property=CPUWeight=${CPU_WEIGHT[rank]}`]);
  assert.deepEqual(toolingSliceArgs({ NTS_MEMORY_PRIORITY: "full-check" }, "landing"), [`--slice=${RANK_SLICE}`, "--property=CPUWeight=1000"],
    "the named rank decides, never a variable the process happens to carry");
  assert.deepEqual(toolingSliceArgs({ NTS_TOOLING_SLICE: "nts-r12345678.slice" }, "landing"), ["--slice=nts-r12345678.slice"], "a run's root already carries its rank");
});

test("a gate command's cpuset scope goes where its launcher places it, at the launcher's rank", () => {
  // The delegated-cpuset path: the landing's build and runner keep the landing's weight, the full check's its own.
  assert.deepEqual(scopeArgs("0-3,6-31", { rank: "landing", env: {} }).slice(0, 4), ["--user", "--scope", `--slice=${RANK_SLICE}`, `--property=CPUWeight=${CPU_WEIGHT.landing}`]);
  assert.deepEqual(scopeArgs("0-3,6-31", { rank: "full-check", env: {} }).slice(2, 4), [`--slice=${RANK_SLICE}`, `--property=CPUWeight=${CPU_WEIGHT["full-check"]}`]);
  assert.deepEqual(scopeArgs("0-3,6-31", { rank: "landing", env: { NTS_TOOLING_SLICE: "nts-r12345678.slice" } }).slice(2, 4), ["--slice=nts-r12345678.slice", "--quiet"]);
});

test("every root slice under nts.slice carries its rank's weight, and a slice nested in a run carries none", () => {
  assert.ok(rankRoot("nts-r12345678.slice") && rankRoot("nts-c0123456789abcdef.slice"));
  assert.ok(!rankRoot("nts-r12345678-s23456789.slice") && !rankRoot("nts.slice"));
  for (const rank of PRIORITIES) assert.deepEqual(rankProperties("nts-r12345678.slice", rank), ["CPUWeight", "t", String(CPU_WEIGHT[rank])]);
  assert.deepEqual(rankProperties("nts-r12345678-s23456789.slice", "landing"), []);
});

test("a root slice that names no rank is refused by name before anything is created", () => {
  // Refused before busctl runs: an unranked root would silently compete at the default weight.
  assert.throws(() => startBoundSlice("nts-r12345678.slice", "nts-test-owner.scope"), /root slice nts-r12345678\.slice names no rank/);
  assert.throws(() => startBoundSlice("nts-r12345678.slice", "nts-test-owner.scope", { max: 2 ** 30 }), /names no rank/);
});

test("a job started outside nts.slice gets a scope of its own there, bound to the unit it was started in; one inside a run stays", () => {
  assert.equal(rankedScopeArgs("agent", {}, { cgroup: IN_A_RUN }), null);
  assert.ok(underRankSlice(IN_A_RUN) && !underRankSlice(AGENT_SHELL));
  assert.deepEqual(rankedScopeArgs("agent", {}, { cgroup: AGENT_SHELL }), ["--user", "--scope", "--quiet", "--collect",
    `--slice=${RANK_SLICE}`, "--property=CPUWeight=100", "--property=BindsTo=tmux-spawn-1.scope", "--property=After=tmux-spawn-1.scope", "--"]);
  assert.deepEqual(rankedScopeArgs("landing", { NTS_TOOLING_SLICE: "nts-r12345678.slice" }, { cgroup: IN_A_RUN, memoryMax: "1073741824" }),
    ["--user", "--scope", "--quiet", "--collect", "--slice=nts-r12345678.slice", "--property=BindsTo=nts-s34567890.scope",
      "--property=After=nts-s34567890.scope", "--property=MemoryMax=1073741824", "--property=MemorySwapMax=0", "--"], "a memory cap always takes a scope");
  assert.throws(() => rankedScopeArgs("agent", {}, { cgroup: "0::/user.slice/user-1000.slice/session-3.scope\n" }), /systemd-run --user --scope/,
    "a shell outside any user-manager unit is told the command to run instead");
});

test("the landing service, an agent's unit and the full check's units ask for their rank's weight", () => {
  const args = serviceArgs("/srv/main", { PATH: "/usr/bin", HOME: "/home/u" });
  assert.ok(args.includes(`--slice=${RANK_SLICE}`), args.join(" "));
  assert.equal(args[args.indexOf(`CPUWeight=${CPU_WEIGHT.landing}`) - 1], "-p", args.join(" "));
  const agent = startArgs("w1", ["run"], { PATH: "/usr/bin", HOME: "/home/u" }, "/work");
  assert.ok(agent.includes(`--slice=${RANK_SLICE}`) && agent.includes(`CPUWeight=${CPU_WEIGHT.agent}`), agent.join(" "));
  assert.ok(lowPriority().includes(`CPUWeight=${CPU_WEIGHT["full-check"]}`));
});

function fixture(t: TestContext) {
  const root = newTestScratch("ranks"), units: string[] = [];
  const memory = ownMemory(join(root, "memory"), { availableKiB: 8 * 2 ** 20, totalKiB: 32 * 2 ** 20, resident: { kind: "live" } });
  const env = gateEnvironment(fixtureEnvironment(t, { NTS_MEMORY_RESERVATION: undefined }), { run: join(root, "canonical"), standalone: true, owned: memory }).env;
  const scopes = new GateScopes(env,{rank:"agent"});
  t.after(() => {
    for (const unit of units) spawnSync("systemctl", ["--user", "stop", unit], { env: fixtureEnvironment(t), stdio: "ignore" });
    stopToolingSlice(scopes.slice);
    removable(root); rmSync(root, { recursive: true, force: true });
  });
  /** A unit with these systemd-run placement arguments, moved into this test's slice. */
  const start = (placement: string[], command: string[], options: { owned?: NodeJS.ProcessEnv; service?: boolean } = {}) => {
    const unit = `nts-test-ranks-${randomUUID()}`; units.push(`${unit}.${options.service ? "service" : "scope"}`);
    const local = placement.map(arg => arg.startsWith("--slice=") ? `--slice=${scopes.slice}` : arg);
    const setenv = Object.entries({ ...env, ...options.owned }).filter((pair): pair is [string, string] => pair[1] !== undefined).map(([key, value]) => `--setenv=${key}=${value}`);
    const child = spawn("systemd-run", ["--user", ...(options.service ? [] : ["--scope"]), `--unit=${unit}`, "--collect", "--quiet",
      ...(options.service ? ["--wait", "--pipe", "--property=LimitCORE=0", "--property=TimeoutStopSec=5s", "--property=RuntimeMaxSec=300s", ...setenv] : []),
      ...local, "--", ...command], { env: { ...env, ...options.owned }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.setEncoding("utf8").on("data", data => { out += data; }); child.stderr.setEncoding("utf8").on("data", data => { err += data; });
    return { unit, done: once(child, "close"), ended: () => child.exitCode !== null ? `unit exited ${child.exitCode}: ${err}` : undefined,
      get stdout() { return out; }, get stderr() { return err; } };
  };
  return { root, memory, env, slice: scopes.slice, group: scopes.group, start };
}

/** The cpu.weight the kernel holds a unit's cgroup at, once the unit has one (cpu-limits.ts's identity-fenced reader). */
const weightOf = (unit: string): number | undefined => {
  const group = spawnSync("systemctl", ["--user", "show", unit, "--property=ControlGroup", "--value"], { encoding: "utf8" }).stdout.trim();
  return group ? cpuControls(group).read().weight : undefined;
};
const IDLE = ["tail", "-f", "/dev/null"];

test("the kernel holds each rank's unit at its weight: a job's scope at its rank, and the landing service's unit at the landing's", async t => {
  const f = fixture(t);
  const ranked = (Object.fromEntries(PRIORITIES.map(rank => [rank, f.start(toolingSliceArgs({}, rank), IDLE)])) as Record<Priority, ReturnType<typeof f.start>>);
  // The landing service's own unit properties; its command a stand-in that waits.
  const service = serviceArgs(f.root, f.env), properties = service.flatMap((arg, at) => service[at - 1] === "-p" ? [`--property=${arg}`] : []);
  const landing = f.start([`--slice=${RANK_SLICE}`, ...properties], IDLE, { service: true });
  for (const rank of PRIORITIES) await waitFor(`the ${rank} scope`, () => weightOf(`${ranked[rank].unit}.scope`) !== undefined, { stopped: ranked[rank].ended });
  await waitFor("the landing service's stand-in", () => weightOf(`${landing.unit}.service`) !== undefined, { stopped: landing.ended });
  for (const rank of PRIORITIES) assert.equal(weightOf(`${ranked[rank].unit}.scope`), CPU_WEIGHT[rank], rank);
  assert.equal(weightOf(`${landing.unit}.service`), CPU_WEIGHT.landing);
});

const OBSERVATIONS = new URL("./host-observations.ts", import.meta.url).href, LIMITS = new URL("./scopes/memory-limits.ts", import.meta.url).href;

test("an admitted job moved into its own scope keeps its pid, its cap and its accounting: the peak it records is its scope's", async t => {
  const f = fixture(t), report = join(f.root, "report.json"), release = join(f.root, "release");
  writeFileSync(release, "");
  // The job: hold 256 MiB; say where it runs, its scope's limits and the peak its scope saw; wait to be released.
  const body = "const fs=require('node:fs'),held=Buffer.alloc(256*2**20,1);(async()=>{"
    + "const {hostObservations}=await import(process.argv[3]),{readLimits}=await import(process.argv[4]);"
    + "const host=hostObservations({}),group=host.ownCgroup(),meter=host.ownScopeMemoryPeak();"
    + "const watcher=fs.watch(process.argv[2],()=>{watcher.close();fs.writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,group,limits:readLimits(group),peak:meter.read(),held:held.length}));});"
    + "fs.writeFileSync(process.argv[1]+'.ready',String(process.pid));})();";
  // Started outside nts.slice, as from an agent's shell; admit.ts is the unit's main
  // process, and the job must keep that pid through systemd-run's move. The cap and
  // the run's slice say where its scope goes.
  const job = f.start([], [process.execPath, ADMIT, "--key", "ranks-move", "--memory-max", "1G", "--", process.execPath, "-e", body, report, release, OBSERVATIONS, LIMITS],
    { service: true, owned: { NTS_TOOLING_SLICE: f.slice } });
  await waitFor("the job and its watcher to observe its allocation", () => existsSync(report + ".ready")
    && (readLedger(f.memory.NTS_MEMORY_LEDGER).admitted.find(entry => entry.live)?.sampledPeak ?? 0) >= 256 * MiB, { stopped: job.ended });
  const mainPid = spawnSync("systemctl", ["--user", "show", `${job.unit}.service`, "--property=MainPID", "--value"], { encoding: "utf8" }).stdout.trim();
  assert.equal(readFileSync(report + ".ready", "utf8"), mainPid, "the command is admit.ts's own process, after systemd-run's move");
  writeFileSync(release, "finish");
  assert.deepEqual(await job.done, [0, null], job.stderr);
  const seen = JSON.parse(readFileSync(report, "utf8")) as { pid: number; group: string; limits: { max: number; swap: number }; peak: number; held: number };
  assert.match(seen.group, new RegExp(`/${f.slice.replaceAll(".", "\\.")}/run-[^/]+\\.scope$`), "a scope of its own, inside its run's slice");
  assert.deepEqual([seen.limits.max, seen.limits.swap], [2 ** 30, 0]);
  const recorded = readCostHistory(historyFile(f.memory)).jobs.get("ranks-move")!.observations.at(-1)!.peak;
  assert.ok(recorded >= 256 * MiB, `the recorded peak ${recorded} holds the job's allocation`);
  assert.ok(Math.abs(recorded - seen.peak) <= seen.peak / 4,
    `the recorded peak (${(recorded / MiB).toFixed(0)} MiB) follows the job's own scope (${(seen.peak / MiB).toFixed(0)} MiB)`);
});
