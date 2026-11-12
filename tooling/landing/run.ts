import {GNU_CPU_MEASURE,type GnuTime} from '../gate/step-time.ts';
// Run a change's landing steps in a tree: the gate's own steps, through its own
// runner, in the landing check's profile.
//
// **The compiler builds first, in the incremental `nts-dev` profile**, as
// pinned.sh builds before the gate: the steps drive it (NTS_BIN), and a warm
// tree rebuilds only the crates a change reaches. `tests` and `doctests`
// build in the same profile (NTS_TEST_PROFILE), so their crates are the ones
// the compiler was built from. Then every other landing step runs in one
// `sh tooling/gate/all.sh` under the canonical environment
// (canonical-environment.ts), with the run's slots, memory reservation and
// summary.json the runner keeps.
//
// **Memory is the machine's memory ledger's to give** (tooling/gate/
// memory-ledger.ts), at the priority the caller names (NTS_MEMORY_PRIORITY):
// the service's runs at the landing priority, ahead of agents' work and the
// full check, and an agent's own `--here` pre-check at the agent priority, so
// a queued landing takes the memory a pre-check reserved but does not use
// instead of waiting at one priority for the pre-check to finish (#672). The
// build waits its turn for what this tree's landing builds held, in a
// reservation this process holds; the runner's first request takes it over,
// and the runner holds the steps'.
//
// **Memory pressure is a wait, never a verdict.** A step the runner reports as
// an instrument failure of kind memory-pressure runs again, alone, in a run
// whose reservation waits until memory allows, keeping every result that
// completed. Any other unfinished measurement holds the change for a person;
// only a step that ran and failed refuses it.
//
// Lines a check prints for a case its record has no row for yet, or for a
// recorded case that got better (tooling/records/pending.ts), are listed as
// information: the full check writes those rows.
import { removable } from "../gate/run-temporary.ts";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gateCommand } from "../gate/affinity.ts";
import { ENVIRONMENT_CONTEXT, ENVIRONMENT_EXPERIMENT } from "../gate/canonical-environment.ts";
import { gateEnvironmentError } from "../gate/environment.ts";
import { instrumentPolicy } from "../gate/step-result.ts";
import { TEST_PROFILE } from "../gate/test-profile.ts";
import {DiskCapacity} from '../gate/disk-capacity.ts';
import { STANDING_GATE_POLICY } from "../gate/verdict-policy.ts";
import { cpus } from "node:os";
import { machineBudget } from "./selection.ts";
import { nodePin } from "../bootstrap/node.ts";
import { nodeToolchain } from "../gate/toolchain.ts";
import { candidateCommand } from "./candidate-environment.ts";
import { STEPS } from "../gate/step-table.mjs";
import { isListedLine } from "../records/pending.ts";
import { reserveJob, type Priority, type Reservation } from "../gate/memory-ledger.ts";
import { validContract, type VerdictContract } from "../gate/verdict-contract.ts";

export const PROFILE = TEST_PROFILE;
type BinaryIdentities = Record<string, string | null>;
export type StepResult = {
  name: string; verdict: "PASS" | "FAIL" | "INSTRUMENT" | "SKIPPED" | "NOT RUN"; reason?: string;
  cpu?: number;cpu_measure?:string;gnu_time?:GnuTime;wall?: number; log?: string; accepted?: boolean; attempt?: number;
  instrument?: { kind?: string; verdict?: string; completedFailures?: number };
  binaries?: BinaryIdentities;
};
export type Ran = { state: "green" | "red" | "held"; message: string; run: string; steps: StepResult[]; pending: string[]; wall_s: number;
  contract?: VerdictContract; binaries?: BinaryIdentities };
export type RunOptions = {
  tree: string; target: string; run: string; commit: string;
  /** The landing steps, as all.sh names them; `build` is the compiler's build. */
  steps: readonly string[];
  interop?: string | null; doctests?: string | null;
  /** The launcher's environment: only its host capabilities reach a step. */
  env?: NodeJS.ProcessEnv;
  /** The priority this run reserves memory at: the service's landings by default; `check.ts --here` names an agent's. */
  priority?: Priority;
  /** Told when memory pressure sends steps back to run again. */
  hold?: (reason: string) => void;
  /** The command that builds the compiler; cargo in `nts-dev` by default. */
  build?: readonly string[];
  /** Variables the caller's code owns beyond the run's (a test's controls). */
  owned?: Readonly<Record<string, string>>;
  /** How many times memory pressure may send a step back before a person is asked. */
  attempts?: number;
  /** Installed toolchains; private fixtures supply their own installation root. */
  nodeInstallations?: string;
  /** The most any step may run, in seconds: the landing check's ceiling (step-bound.ts's landingCeiling). */
  ceiling?: number;
};

/** The workers a landing build is sized by: the gate's build step's, its row's slots. */
const BUILD_WIDTH = STEPS.find(row => row.name === "build")!.slots;

/**
 * The environment a landing run starts from: the launcher's host
 * capabilities, never another run's context. A landing check started inside
 * a gate step -- this file's own tests, in the tooling step -- would otherwise
 * be read as that gate re-entering itself and inherit its owned policy:
 * that gate's NTS_GATE_FAIL_FAST stops the other steps after one fails.
 */
export function launcherEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const own = { ...env };
  delete own[ENVIRONMENT_CONTEXT];
  delete own[ENVIRONMENT_EXPERIMENT];
  return own;
}

export async function runLanding(options: RunOptions): Promise<Ran> {
  const started = Date.now();
  const { tree, target, run } = options;
  mkdirSync(run, { recursive: true });
  const results: StepResult[] = [];
  let contract: VerdictContract | undefined;
  let probeContract: (() => VerdictContract | undefined) | undefined;
  const finish = (state: Ran["state"], message: string): Ran => {
    const completed = state === "green" && contract ? probeContract?.() : undefined;
    if (state === "green" && contract && completed?.identity !== contract.identity) {
      appendFileSync(join(run, "verdict-contract.log"), "landing verdict contract changed or became unavailable during the check\n");
      contract = undefined;
    }
    const binaries = results.find(row => row.name === "build")?.binaries ??
      results.find(row => row.binaries)?.binaries ?? {};
    const ran: Ran = { state, message, run, steps: results, pending: pendingLines(run), wall_s: (Date.now() - started) / 1000,
      ...(state === "green" && contract ? { contract, binaries } : {}) };
    writeFileSync(join(run, "landing.json"), JSON.stringify(ran, null, 2) + "\n");
    return ran;
  };
  let selected: ReturnType<typeof nodeToolchain>;
  try { selected=nodeToolchain(nodePin(tree),launcherEnvironment(options.env),options.nodeInstallations); }
  catch(error) { return finish("held", String(error)); }
  const launcher=selected.env;
  const owned = {
    NTS_GATE_RUN_DIR: run, CARGO_TARGET_DIR: target, CARGO_INCREMENTAL: "1", NTS_TEST_PROFILE: PROFILE,
    NTS_BIN: join(target, PROFILE, "nts"), NTS_SUITE_BIN: join(target, PROFILE, "nts-suite"), NTS_CHECKERS: "1",
    ...STANDING_GATE_POLICY,
    NTS_MEMORY_PRIORITY: options.priority ?? "landing",
    // The scopes the rules narrowed a step to: the touched crates' doc tests, the interop projects a change reaches.
    ...(options.doctests && options.steps.includes("doctests") ? { NTS_DOCTEST_CRATES: options.doctests } : {}),
    ...(options.interop && options.steps.includes("interop") ? { NTS_INTEROP_PROJECTS: options.interop } : {}),
    // A stuck step holds the queue for minutes, not the hour the full check allows.
    ...(options.ceiling !== undefined ? { NTS_GATE_STEP_CEILING_S: String(options.ceiling) } : {}),
    ...options.owned,
  };
  probeContract = () => {
    const helper = join(tree, "tooling/gate/verdict-contract.ts");
    if (!existsSync(helper)) return undefined;
    const file = join(run, "verdict-contract.json");
    try {
      const result = candidateCommand(selected.node, {
        tree, run: join(run, "contract"), owned, discardTemporary: true,
        command: [selected.node, helper, file],
      }, launcher);
      if (result.error || result.signal || result.status !== 0) throw Error(result.error?.message ?? result.signal ?? result.stderr);
      const value: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!validContract(value)) throw Error("candidate wrote an invalid verdict contract");
      return value;
    } catch (error) {
      appendFileSync(join(run, "verdict-contract.log"), String(error) + "\n");
      return undefined;
    }
  };
  contract = probeContract();
  const rest = options.steps.filter(step => step !== "build");
  let environment: string | null;
  try { environment = rest.length ? gateEnvironmentError(tree, rest, options.interop ?? null, launcher) : null; }
  catch (error) { return finish("held", `the tree's gate could not say what its steps need: ${(error as Error).message}`); }
  if (environment) return finish("held", `environment: ${environment}`);

  // **The landing holds one reservation from its build to its gate run's
  // admission.** It reserves landing-build in this process, so the build runs
  // inside it, and hands it to the gate run (NTS_MEMORY_HANDOVER): the
  // decision that admits the run's first request ends it, under the ledger's
  // lock, so nothing is admitted between the two. A job admitted in the
  // seconds between a build and its gate run held that run's growth for the
  // rest of the run (#615).
  let hold: Reservation | undefined;
  try {
    if (options.steps.includes("build")) {
      const log = join(run, "build.log");
      try {
        hold = await reserveJob({ key: "landing-build", units: BUILD_WIDTH, what: `landing build of ${options.commit.slice(0, 12)}` },
          { env: { ...launcher, ...owned }, report: line => appendFileSync(log, `${line}\n`) });
      } catch (error) {
        appendFileSync(log, `${String(error)}\n`);
        const reason = `its memory was not reserved: ${(error as Error).message}`;
        results.push({ name: "build", verdict: "INSTRUMENT", reason, log });
        for (const step of rest) results.push({ name: step, verdict: "NOT RUN", reason: "needs build, which is INSTRUMENT" });
        return finish("held", `build: ${reason}`);
      }
      for (let attempt = 1; ; attempt++) {
        const built = buildCompiler(options, selected.node, launcher, { ...owned, ...hold.env }, attempt);
        if (built.verdict === "INSTRUMENT" && attempt < (options.attempts ?? 3)) continue;
        results.push(built);
        if (built.verdict === "PASS") break;
        for (const step of rest) results.push({ name: step, verdict: "NOT RUN", reason: `needs build, which is ${built.verdict}` });
        return built.verdict === "FAIL" ? finish("red", `build FAIL; log ${built.log}`) : finish("held", `build: ${built.reason}`);
      }
    }
    if (!rest.length) return finish("green", "green");
    return finishSteps(options, selected.node, launcher, owned, rest, results, finish, hold);
  } finally { hold?.release(); await hold?.closed; }
}

/**
 * The steps after the build, run again, alone, while memory pressure kept
 * some from measuring. The first run takes over `hold`, the build's
 * reservation; a run that did not take it over never needs it again.
 */
function finishSteps(options: RunOptions, node: string, launcher: NodeJS.ProcessEnv, owned: Record<string, string>, rest: readonly string[],
  results: StepResult[], finish: (state: Ran["state"], message: string) => Ran, hold: Reservation | undefined): Ran {
  const rows = new Map<string, StepResult>();
  let pending = [...rest];
  for (let attempt = 1; pending.length; attempt++) {
    const dir = attempt === 1 ? options.run : join(options.run, `attempt-${attempt}`);
    const handover: Record<string, string> = attempt === 1 && hold && !hold.inherited ? { NTS_MEMORY_HANDOVER: hold.id } : {};
    const measured = runSteps(options, node, launcher, { ...owned, NTS_GATE_RUN_DIR: dir, NTS_GATE_STEPS: pending.join(" "), ...handover }, dir, pending);
    if (attempt === 1) hold?.release();
    if ("held" in measured) { for (const step of pending) rows.set(step, { name: step, verdict: "NOT RUN", reason: measured.held }); results.push(...rest.map(step => rows.get(step)!)); return finish("held", measured.held); }
    for (const row of measured.rows) rows.set(row.name, { ...row, ...(attempt > 1 ? { attempt } : {}) });
    const retry = measured.rows.filter(row => row.verdict === "INSTRUMENT" && instrumentPolicy(row.instrument?.kind, row.instrument?.completedFailures)?.disposition === "retry");
    if (retry.length && attempt >= (options.attempts ?? 3)) break;
    if (retry.length) options.hold?.(`memory pressure kept ${retry.map(r => r.name).join(" ")} from measuring: they run again once memory allows`);
    pending = retry.map(row => row.name);
  }
  results.push(...rest.map(step => rows.get(step) ?? { name: step, verdict: "NOT RUN" as const, reason: "the runner did not report it" }));
  const failed = results.filter(r => r.verdict === "FAIL" || (r.verdict === "SKIPPED" && !r.accepted));
  if (failed.length) return finish("red", `${failed.map(r => `${r.name} ${r.verdict}`).join(", ")}; logs ${options.run}`);
  const unfinished = results.filter(r => r.verdict !== "PASS" && !(r.verdict === "SKIPPED" && r.accepted));
  if (unfinished.length) return finish("held", unfinished.map(r => `${r.name} ${r.verdict}: ${r.reason ?? "did not finish"}`).join("; "));
  return finish("green", "green");
}

/**
 * One build of the compiler, inside the landing's reservation, which `owned`
 * names. That reservation is what this tree's earlier landing builds held, in
 * its target's history, and the build's peak joins them as it is released.
 * Never measured, it sizes as the gate's build step does, at the build row's
 * width: not one share per cargo job, which for 24 jobs would be the whole
 * machine. The first build's log follows what the reservation said while it
 * waited.
 */
function buildCompiler(options: RunOptions, node: string, launcher: NodeJS.ProcessEnv, owned: Record<string, string>, attempt: number): StepResult {
  let release:(()=>void)|undefined;
  try{
    release=new DiskCapacity({env:{...launcher,...owned}}).beginBuild({root:options.tree,target:options.target,outputs:['nts-dev']});
    return buildCompilerAdmitted(options,node,launcher,owned,attempt);
  }catch(error){return {name:'build',verdict:'INSTRUMENT',reason:String(error),log:join(options.run,'build.log')};}
  finally{release?.();}
}
function buildCompilerAdmitted(options: RunOptions, node: string, launcher: NodeJS.ProcessEnv, owned: Record<string, string>, attempt: number): StepResult {
  const log = join(options.run, attempt === 1 ? "build.log" : `build-${attempt}.log`), time = `${log}.time`;
  // The run's slots, as the gate sizes itself: the steps after it get the same.
  const slots = machineBudget(cpus().length).slots;
  const command = options.build ?? ["cargo", "build", "--profile", PROFILE, "--jobs", String(slots)];
  const timed = existsSync("/usr/bin/time") ? ["/usr/bin/time", "-f", "%e %U %S %M", "-o", time, ...command] : [...command];
  const launch = gateCommand(timed[0]!, timed.slice(1));
  const r = candidateCommand(node, { tree: options.tree, run: options.run, owned, command: [launch.command, ...launch.args] }, launcher);
  appendFileSync(log, `${r.stdout ?? ""}${r.stderr ?? ""}`);
  let cpu: number | undefined, wall: number | undefined;
  try {
    const [e, u, s] = readFileSync(time, "utf8").trim().split("\n").pop()!.split(" ").map(Number);
    if ([e, u, s].every(Number.isFinite)) { wall = e; cpu = u! + s!; }
  } catch { /* unmeasured */ }
  const measured = { ...(cpu !== undefined ? { cpu,cpu_measure:GNU_CPU_MEASURE } : {}), ...(wall !== undefined ? { wall } : {}), log };
  // Killed rather than failed: the machine's doing (an OOM kill), not the change's.
  if (r.error || r.signal) return { name: "build", verdict: "INSTRUMENT", reason: `the build was ${r.signal ? `killed by ${r.signal}` : `not started: ${r.error?.message}`}`, ...measured };
  if (r.status !== 0) return { name: "build", verdict: "FAIL", reason: `exit ${r.status}`, ...measured };
  const binaries = Object.fromEntries(["nts", "nts-suite"].map(name => {
    let hash: string | null = null;
    try { hash = createHash("sha256").update(readFileSync(join(options.target, PROFILE, name))).digest("hex"); }
    catch { /* A fixture's build may provide only one executable. */ }
    return [name, hash];
  }));
  return { name: "build", verdict: "PASS", ...measured, binaries };
}

type Summary = { identities?: { commit?: string | null; nts?: { sha256?: string | null }; nts_suite?: { sha256?: string | null } };
  interrupted?: unknown; environment?: { canonical?: boolean }; steps?: StepResult[] };
function runSteps(options: RunOptions, node: string, launcher: NodeJS.ProcessEnv, owned: Record<string, string>, dir: string, steps: readonly string[]): { rows: StepResult[] } | { held: string } {
  mkdirSync(dir, { recursive: true });
  const launch = gateCommand("sh", [join(options.tree, "tooling/gate/all.sh")]);
  const r = candidateCommand(node, { tree: options.tree, run: dir, owned, command: [launch.command, ...launch.args] }, launcher);
  writeFileSync(join(dir, "gate.log"), `${r.stdout ?? ""}${r.stderr ?? ""}`);
  let summary: Summary;
  try { summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")) as Summary; }
  catch (error) { return { held: `the runner left no readable summary (${r.signal ?? `exit ${r.status}`}): ${String(error)}; see ${join(dir, "gate.log")}` }; }
  if (!Array.isArray(summary.steps)) return { held: `the summary lists no steps; see ${dir}` };
  if (summary.identities?.commit !== options.commit) return { held: `the summary names ${summary.identities?.commit ?? "no commit"}, not ${options.commit.slice(0, 12)}` };
  if (summary.interrupted != null) return { held: `the run was interrupted: ${String(summary.interrupted)}` };
  if (summary.environment?.canonical !== true) return { held: "the run's environment was not canonical" };
  const rows = summary.steps.filter(row => steps.includes(row.name));
  for (const step of steps) if (!rows.some(row => row.name === step)) rows.push({ name: step, verdict: "NOT RUN", reason: "the runner did not report it" });
  const binaries = summary.identities?.nts ? {
    nts: summary.identities.nts.sha256 ?? null, "nts-suite": summary.identities.nts_suite?.sha256 ?? null,
  } : undefined;
  return { rows: rows.map(row => ({ ...row, ...(row.log ? {} : { log: join(dir, `${row.name}.log`) }), ...(binaries ? { binaries } : {}) })) };
}

/**
 * The lines the run's step logs print for the records: each pending case and
 * accepted change, as tooling/records/pending.ts names them.
 */
export function pendingLines(run: string): string[] {
  const out = new Set<string>();
  const visit = (dir: string, depth: number) => {
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names.sort()) {
      if (depth < 1 && /^attempt-\d+$/.test(name)) visit(join(dir, name), depth + 1);
      else if (name.endsWith(".log")) {
        try { for (const line of readFileSync(join(dir, name), "utf8").split("\n")) if (isListedLine(line)) out.add(line.trim()); } catch { /* unreadable log */ }
      }
    }
  };
  visit(run, 0);
  return [...out];
}

/**
 * Remove a run's directory. A red run keeps its temporary directory, which
 * can hold read-only captured inputs (a sealed dependency tree): the run's own
 * directories get their write permission back first, never through a link,
 * and a directory another user owns is refused.
 */
export function removeRun(path: string): void {
  try { removable(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  rmSync(path, { recursive: true, force: true });
}
