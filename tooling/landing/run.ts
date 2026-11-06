// Run a change's landing steps in a tree: the gate's own steps, through its own
// runner, in the landing check's profile.
//
// **The compiler builds first, in the incremental `nts-dev` profile**, as
// pinned.sh builds before the gate: the steps drive it (NTS_BIN), and a warm
// tree rebuilds only the crates a change reaches. `tests` and `doctests`
// build in the same profile (NTS_TEST_PROFILE), so their crates are the ones
// the compiler was built from. Then every other landing step runs in one
// `sh tooling/gate/all.sh` under the canonical environment
// (canonical-environment.ts), with the run's slots, memory admission and
// summary.json the runner keeps.
//
// **Memory pressure is a wait, never a verdict.** A step the runner reports as
// an instrument failure of kind memory-pressure runs again once memory allows,
// alone, keeping every result that completed. Any other unfinished
// measurement holds the change for a person; only a step that ran and failed
// refuses it.
//
// Lines a check prints for a case its record has no row for yet, or for a
// recorded case that got better (tooling/records/pending.ts), are listed as
// information: the full check writes those rows.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gateCommand } from "../gate/affinity.ts";
import { RESUME_AT_GB, memAvailableGB } from "../gate/admission.ts";
import { ENVIRONMENT_CONTEXT, ENVIRONMENT_EXPERIMENT, gateEnvironment } from "../gate/canonical-environment.ts";
import { gateEnvironmentError } from "../gate/environment.ts";
import { instrumentPolicy } from "../gate/step-result.ts";
import { STEPS } from "../gate/step-table.mjs";
import { TEST_BUILD_DEBUG, TEST_BUILD_OPT_LEVEL } from "../gate/test-artifacts.ts";
import { STANDING_GATE_POLICY } from "../gate/verdict-policy.ts";
import { cpus } from "node:os";
import { machineBudget } from "./selection.ts";

export const PROFILE = "nts-dev";
export type StepResult = {
  name: string; verdict: "PASS" | "FAIL" | "INSTRUMENT" | "SKIPPED" | "NOT RUN"; reason?: string;
  cpu?: number; wall?: number; log?: string; accepted?: boolean; attempt?: number;
  instrument?: { kind?: string; verdict?: string; completedFailures?: number };
};
export type Ran = { state: "green" | "red" | "held"; message: string; run: string; steps: StepResult[]; pending: string[]; wall_s: number };
export type RunOptions = {
  tree: string; target: string; run: string; commit: string;
  /** The landing steps, as all.sh names them; `build` is the compiler's build. */
  steps: readonly string[];
  interop?: string | null; doctests?: string | null;
  /** The launcher's environment: only its host capabilities reach a step. */
  env?: NodeJS.ProcessEnv;
  /** Told while the run waits for memory. */
  hold?: (reason: string) => void;
  memory?: () => number | null; pause?: () => void;
  /** The command that builds the compiler; cargo in `nts-dev` by default. */
  build?: readonly string[];
  /** Variables the caller's code owns beyond the run's (a test's controls). */
  owned?: Readonly<Record<string, string>>;
  /** How many times memory pressure may send a step back before a person is asked. */
  attempts?: number;
};

const ROWS = new Map((STEPS as { name: string; treeOnly?: boolean }[]).map(row => [row.name, row]));
const sleep = () => { spawnSync("sleep", ["10"]); };

/**
 * The environment a landing run starts from: the launcher's host
 * capabilities, never another run's context. A landing check started inside
 * a gate step -- this file's own tests, in the tooling step -- would otherwise
 * be read as that gate re-entering itself and inherit its owned policy:
 * a train's NTS_GATE_TRAIN_MEMBERS arms the runner's red-stop, which cancels
 * the other steps after one fails.
 */
export function launcherEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const own = { ...env };
  delete own[ENVIRONMENT_CONTEXT];
  delete own[ENVIRONMENT_EXPERIMENT];
  return own;
}

export function runLanding(options: RunOptions): Ran {
  const started = Date.now();
  const { tree, target, run } = options;
  const launcher = launcherEnvironment(options.env);
  mkdirSync(run, { recursive: true });
  const results: StepResult[] = [];
  const finish = (state: Ran["state"], message: string): Ran => {
    const ran: Ran = { state, message, run, steps: results, pending: pendingLines(run), wall_s: (Date.now() - started) / 1000 };
    writeFileSync(join(run, "landing.json"), JSON.stringify(ran, null, 2) + "\n");
    return ran;
  };
  const owned = {
    NTS_GATE_RUN_DIR: run, CARGO_TARGET_DIR: target, CARGO_INCREMENTAL: "1", NTS_TEST_PROFILE: PROFILE,
    NTS_BIN: join(target, PROFILE, "nts"), NTS_SUITE_BIN: join(target, PROFILE, "nts-suite"), NTS_CHECKERS: "1",
    CARGO_PROFILE_DEV_DEBUG: TEST_BUILD_DEBUG, CARGO_PROFILE_DEV_OPT_LEVEL: TEST_BUILD_OPT_LEVEL, ...STANDING_GATE_POLICY,
    // The scopes the rules narrowed a step to: the touched crates' doc tests, the interop projects a change reaches.
    ...(options.doctests && options.steps.includes("doctests") ? { NTS_DOCTEST_CRATES: options.doctests } : {}),
    ...(options.interop && options.steps.includes("interop") ? { NTS_INTEROP_PROJECTS: options.interop } : {}),
    ...options.owned,
  };
  const rest = options.steps.filter(step => step !== "build");
  let environment: string | null;
  try { environment = rest.length ? gateEnvironmentError(tree, rest, options.interop ?? null, launcher) : null; }
  catch (error) { return finish("held", `the tree's gate could not say what its steps need: ${(error as Error).message}`); }
  if (environment) return finish("held", `environment: ${environment}`);
  const heavy = options.steps.some(step => !ROWS.get(step)?.treeOnly);
  const admit = (what: string) => {
    if (!heavy) return;
    const read = options.memory ?? memAvailableGB;
    for (let said = false; ;) {
      const gb = read();
      if (gb === null || gb >= RESUME_AT_GB) return;
      if (!said) { options.hold?.(`memory: ${gb.toFixed(1)} GB available, waiting for ${RESUME_AT_GB} GB before ${what}`); said = true; }
      (options.pause ?? sleep)();
    }
  };

  if (options.steps.includes("build")) {
    for (let attempt = 1; ; attempt++) {
      admit("the build");
      const built = buildCompiler(options, launcher, owned, attempt);
      if (built.verdict === "INSTRUMENT" && attempt < (options.attempts ?? 3)) continue;
      results.push(built);
      if (built.verdict === "PASS") break;
      for (const step of rest) results.push({ name: step, verdict: "NOT RUN", reason: `needs build, which is ${built.verdict}` });
      return built.verdict === "FAIL" ? finish("red", `build FAIL; log ${built.log}`) : finish("held", `build: ${built.reason}`);
    }
  }
  if (!rest.length) return finish("green", "green");

  const rows = new Map<string, StepResult>();
  let pending = [...rest];
  for (let attempt = 1; pending.length; attempt++) {
    admit(attempt === 1 ? "the steps" : `${pending.join(" ")} again`);
    const dir = attempt === 1 ? run : join(run, `attempt-${attempt}`);
    const measured = runSteps(options, launcher, { ...owned, NTS_GATE_RUN_DIR: dir, NTS_GATE_STEPS: pending.join(" ") }, dir, pending);
    if ("held" in measured) { for (const step of pending) rows.set(step, { name: step, verdict: "NOT RUN", reason: measured.held }); results.push(...rest.map(step => rows.get(step)!)); return finish("held", measured.held); }
    for (const row of measured.rows) rows.set(row.name, { ...row, ...(attempt > 1 ? { attempt } : {}) });
    const retry = measured.rows.filter(row => row.verdict === "INSTRUMENT" && instrumentPolicy(row.instrument?.kind, row.instrument?.completedFailures)?.disposition === "retry");
    if (retry.length && attempt >= (options.attempts ?? 3)) break;
    if (retry.length) options.hold?.(`memory pressure kept ${retry.map(r => r.name).join(" ")} from measuring: they run again once memory allows`);
    pending = retry.map(row => row.name);
  }
  results.push(...rest.map(step => rows.get(step) ?? { name: step, verdict: "NOT RUN" as const, reason: "the runner did not report it" }));
  const failed = results.filter(r => r.verdict === "FAIL" || (r.verdict === "SKIPPED" && !r.accepted));
  if (failed.length) return finish("red", `${failed.map(r => `${r.name} ${r.verdict}`).join(", ")}; logs ${run}`);
  const unfinished = results.filter(r => r.verdict !== "PASS" && !(r.verdict === "SKIPPED" && r.accepted));
  if (unfinished.length) return finish("held", unfinished.map(r => `${r.name} ${r.verdict}: ${r.reason ?? "did not finish"}`).join("; "));
  return finish("green", "green");
}

function buildCompiler(options: RunOptions, launcher: NodeJS.ProcessEnv, owned: Record<string, string>, attempt: number): StepResult {
  const log = join(options.run, attempt === 1 ? "build.log" : `build-${attempt}.log`), time = `${log}.time`;
  // The run's slots, as the gate sizes itself: the steps after it get the same.
  const command = options.build ?? ["cargo", "build", "--profile", PROFILE, "--jobs", String(machineBudget(cpus().length).slots)];
  const env = gateEnvironment(launcher, { run: options.run, owned }).env;
  const timed = existsSync("/usr/bin/time") ? ["/usr/bin/time", "-f", "%e %U %S %M", "-o", time, ...command] : [...command];
  const launch = gateCommand(timed[0]!, timed.slice(1));
  const r = spawnSync(launch.command, launch.args, { cwd: options.tree, env, encoding: "utf8", maxBuffer: 1 << 30 });
  writeFileSync(log, `${r.stdout ?? ""}${r.stderr ?? ""}`);
  let cpu: number | undefined, wall: number | undefined;
  try {
    const [e, u, s] = readFileSync(time, "utf8").trim().split("\n").pop()!.split(" ").map(Number);
    if ([e, u, s].every(Number.isFinite)) { wall = e; cpu = u! + s!; }
  } catch { /* unmeasured */ }
  const measured = { ...(cpu !== undefined ? { cpu } : {}), ...(wall !== undefined ? { wall } : {}), log };
  // Killed rather than failed: the machine's doing (an OOM kill), not the change's.
  if (r.error || r.signal) return { name: "build", verdict: "INSTRUMENT", reason: `the build was ${r.signal ? `killed by ${r.signal}` : `not started: ${r.error?.message}`}`, ...measured };
  return r.status === 0 ? { name: "build", verdict: "PASS", ...measured } : { name: "build", verdict: "FAIL", reason: `exit ${r.status}`, ...measured };
}

type Summary = { identities?: { commit?: string | null }; interrupted?: unknown; environment?: { canonical?: boolean }; steps?: StepResult[] };
function runSteps(options: RunOptions, launcher: NodeJS.ProcessEnv, owned: Record<string, string>, dir: string, steps: readonly string[]): { rows: StepResult[] } | { held: string } {
  mkdirSync(dir, { recursive: true });
  const env = gateEnvironment(launcher, { run: dir, owned }).env;
  const launch = gateCommand("sh", [join(options.tree, "tooling/gate/all.sh")]);
  const r = spawnSync(launch.command, launch.args, { cwd: options.tree, env, encoding: "utf8", maxBuffer: 1 << 30 });
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
  return { rows: rows.map(row => ({ ...row, ...(row.log ? {} : { log: join(dir, `${row.name}.log`) }) })) };
}

/**
 * The pending and improved lines the run's step logs print. Their shapes are
 * tooling/records/pending.ts's: `pending: <case> is not recorded in <record>
 * yet` and `improved, record pending: <case> <before> -> <after>`.
 */
export function pendingLines(run: string): string[] {
  const out = new Set<string>();
  const shape = /^\s*((?:pending: .+ is not recorded in .+ yet)|(?:improved, record pending: .+))\s*$/;
  const visit = (dir: string, depth: number) => {
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names.sort()) {
      if (depth < 1 && /^attempt-\d+$/.test(name)) visit(join(dir, name), depth + 1);
      else if (name.endsWith(".log")) {
        try { for (const line of readFileSync(join(dir, name), "utf8").split("\n")) { const m = shape.exec(line); if (m) out.add(m[1]!); } } catch { /* unreadable log */ }
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
 * and a directory another user owns is left as it is.
 */
export function removeRun(path: string): void {
  const walk = (at: string) => {
    const info = lstatSync(at);
    if (info.isSymbolicLink() || !info.isDirectory() || info.uid !== process.getuid?.()) return;
    chmodSync(at, (info.mode & 0o777) | 0o700);
    for (const name of readdirSync(at)) walk(join(at, name));
  };
  try { walk(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  rmSync(path, { recursive: true, force: true });
}
