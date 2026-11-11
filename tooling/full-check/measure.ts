// A measurement: gate steps at one commit, run the way the full run runs them
// -- pinned.sh in the full check's own tree and target, in the gate's
// canonical environment -- and read back from the run's summary.json.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORM_PROGRAMS, PLATFORMS_UNRUN_OK, unrunPlatforms, type UnrunPolicy } from "../gate/verdict-policy.ts";
import type { Layout, RunRecord } from "./state.ts";
import { readBaseline } from "../landing/selection.ts";
import { newToolingSlice } from "../gate/tooling-slice.ts";
import { MEASUREMENT_HOLD } from "./measure-command.ts";
import {nodePin} from "../bootstrap/node.ts";
import {nodeToolchain} from "../gate/toolchain.ts";
import {candidateCommand} from '../landing/candidate-environment.ts';
import {launcherEnvironment} from '../landing/run.ts';
import {GateResource} from '../gate/gate-resource.ts';
import {fullOwned} from '../census/full-plan.ts';

/**
 * A step's result as the full check reads it: a skip the policy accepts is a
 * pass, and a platform's programs left unrun hold a step that passed, unless
 * the policy lets that platform stay unrun (verdict-policy.ts).
 */
export type StepResult = "PASS" | "FAIL" | "HELD";

export type Measurement = {
  commit: string;
  run: string;
  steps: Record<string, StepResult>;
  reasons: Record<string, string>;
  verdict: "green" | "red" | "held";
};

export function verdictOf(steps: Record<string, StepResult>): Measurement["verdict"] {
  const values = Object.values(steps);
  return values.includes("FAIL") ? "red" : values.every(v => v === "PASS") ? "green" : "held";
}

type Summary = {
  verdict?: string;
  wall_s?: number;
  identities?: { commit?: string };
  environment?: { canonical?: boolean };
  steps?: { name: string; verdict: string; reason?: string; accepted?: boolean }[];
};

const PLATFORM_STEPS = new Set(Object.values(PLATFORM_PROGRAMS).map(programs => programs.step));
const logOf = (run: string, step: string) => { try { return readFileSync(join(run, `${step}.log`), "utf8"); } catch { return ""; } };

/** What a run's summary says of each requested step; anything it cannot vouch for is held. */
export function readSummary(run: string, commit: string, requested: readonly string[], unrun: UnrunPolicy = PLATFORMS_UNRUN_OK): Pick<Measurement, "steps" | "reasons"> {
  const steps: Record<string, StepResult> = {}, reasons: Record<string, string> = {};
  const hold = (why: string) => { for (const name of requested) { steps[name] = "HELD"; reasons[name] = why; } return { steps, reasons }; };
  const ceiling = join(run, MEASUREMENT_HOLD);
  if (existsSync(ceiling)) {
    try { return hold(readFileSync(ceiling, "utf8").trim()); }
    catch { return hold("the measurement hold receipt is unreadable"); }
  }
  const file = join(run, "summary.json");
  if (!existsSync(file)) return hold("the run wrote no summary");
  let summary: Summary;
  try { summary = JSON.parse(readFileSync(file, "utf8")) as Summary; } catch (error) { return hold(`unreadable summary: ${String(error)}`); }
  if (!summary.identities?.commit || !commit.startsWith(summary.identities.commit)) return hold(`the summary is of ${summary.identities?.commit ?? "no commit"}, not ${commit.slice(0, 12)}`);
  if (summary.environment?.canonical !== true) return hold("the run was not in the canonical environment");
  const by = new Map((summary.steps ?? []).map(step => [step.name, step]));
  for (const name of requested) {
    const step = by.get(name);
    if (!step) { steps[name] = "HELD"; reasons[name] = "not in the summary"; continue; }
    steps[name] = step.verdict === "PASS" || (step.verdict === "SKIPPED" && step.accepted) ? "PASS" : step.verdict === "FAIL" ? "FAIL" : "HELD";
    if (steps[name] !== "PASS") reasons[name] = `${step.verdict}${step.reason ? `: ${step.reason}` : ""}`;
    else if (PLATFORM_STEPS.has(name)) {
      const refused = unrunPlatforms(name, logOf(run, name), unrun).filter(platform => !platform.accepted);
      if (refused.length) {
        steps[name] = "HELD";
        const allowed = unrun.platforms.length ? `only ${unrun.platforms.join(" and ")}` : "no platform";
        reasons[name] = refused.map(p => `${p.platform} programs did not run, and ${unrun.policy} lets ${allowed} stay unrun: ${p.line}`).join("; ");
      }
    }
  }
  return { steps, reasons };
}

export type Gate = {
  /** Every step the commit's all.sh defines, and the wide ones its owed.mjs names. */
  steps(commit: string): { all: string[]; wide: string[] };
  /** Run `steps` at `commit`; `label` names the run's folder. */
  run(commit: string, steps: readonly string[], label: string, lastGreen?: RunRecord): Measurement;
};

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

/** Three times the last completed run's wall. Before there is one, use
 * three times the longest measured step's wall and the same floor. */
export function fullCheckCeiling(lastGreen: RunRecord | undefined, steps: readonly string[], baseline: string): number {
  let wall: number | undefined;
  if (lastGreen) {
    try {
      const summary = JSON.parse(readFileSync(join(lastGreen.run, "summary.json"), "utf8")) as Summary;
      if (summary.verdict === "green" && summary.environment?.canonical === true &&
          summary.identities?.commit && lastGreen.commit.startsWith(summary.identities.commit) &&
          typeof summary.wall_s === "number" && Number.isFinite(summary.wall_s) && summary.wall_s > 0) wall = summary.wall_s;
    } catch { /* There may be no history, or its run has been pruned. */ }
  }
  if (wall === undefined) {
    const costs = readBaseline(baseline);
    wall = Math.max(0, ...steps.map(step => costs.get(step)?.wall ?? 0));
  }
  return Math.ceil(Math.max(15 * 60, 3 * wall));
}

/** The production gate: pinned.sh from the controller's tree, measuring in the full check's. */
export function pinnedGate(layout: Layout, controller: string, log: (line: string) => void, options:{nodeInstallations?:string;env?:NodeJS.ProcessEnv}={}): Gate {
  const pinned = join(controller, "tooling/gate/pinned.sh");
  const launch = (commit: string, run: string, steps: readonly string[], ceiling?: number) => {
    mkdirSync(run, { recursive: true });
    const selected = nodeToolchain(nodePin(controller, commit), options.env ?? process.env, options.nodeInstallations);
    // Hold pinned.sh's existing tree lock through setup, candidate import and
    // execution, so no other user of this tree can change the imported code.
    const lock = GateResource.tryAcquire(layout.tree + '.lock');
    if (!lock) throw Error('full-check gate tree is in use: ' + layout.tree);
    const launcher = launcherEnvironment(selected.env);
    const owned = {
      ...fullOwned({ candidate: false, commit, label: 'MAIN', run, tree: layout.tree, target: layout.target }, steps),
      NTS_GATE_LOCK_FD: '8', CARGO_TARGET_DIR: layout.target,
      NTS_BIN: join(layout.target, 'release/nts'), NTS_SUITE_BIN: join(layout.target, 'release/nts-suite'),
      // The run reserves its memory in the machine's ledger at the full
      // check's priority: it waits its turn there, and yields to a landing
      // check's or an agent's work, so nothing here waits for the host's.
      NTS_MEMORY_PRIORITY: 'full-check',
    };
    let out: number | undefined;
    try {
      out = openSync(join(run, 'full-check.log'), 'a');
      // Setup's normalization is a short-lived child, never the controller.
      // The measured tree does not exist until pinned.sh has linked its inputs.
      const prepared = spawnSync('sh', [pinned, commit], {
        cwd: controller, env: { ...launcher, ...owned, NTS_GATE_SETUP_ONLY: '1' },
        stdio: ['ignore', out, out, 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', lock.fd],
      });
      if (prepared.status !== 0 || prepared.error || prepared.signal || ceiling === undefined) return prepared;
      const slice = newToolingSlice(false, launcher);
      const measure = fileURLToPath(new URL("./measure-command.ts", import.meta.url));
      log(`full check wall ceiling: ${ceiling} s; logs ${run}`);
      return candidateCommand(selected.node, {
        tree: layout.tree, run, owned: { ...owned, NTS_TOOLING_SLICE: slice }, standalone: true,
        command: ['sh', pinned, '--environment-ready', commit],
      }, launcher, { output: out, treeLock: lock.fd, supervisor: [selected.node, measure, String(ceiling), run, slice] });
    } finally { if (out !== undefined) closeSync(out); lock.close(); }
  };
  return {
    // The commit's own lists, read in the tree pinned.sh sets up for it
    // (NTS_GATE_SETUP_ONLY: checked out, inputs linked, nothing built).
    steps(commit) {
      const setup = join(layout.runs, `setup-${commit.slice(0, 12)}-${stamp()}`);
      const ready = launch(commit, setup, []);
      if (ready.status !== 0) throw new Error(`pinned.sh could not set ${commit.slice(0, 12)} up (exit ${ready.status}); see ${setup}`);
      const selected=nodeToolchain(nodePin(layout.tree),options.env??process.env,options.nodeInstallations);
      const list = spawnSync("sh", ["tooling/gate/all.sh", "--list"], { cwd: layout.tree, env:selected.env, encoding: "utf8" });
      if (list.status !== 0) throw new Error(`all.sh --list at ${commit.slice(0, 12)}: ${list.stderr.trim()}`);
      const wide = spawnSync(selected.node, ["--input-type=module", "-e", 'const { WIDE } = await import("./tooling/gate/owed.mjs"); process.stdout.write(JSON.stringify([...WIDE]))'], { cwd: layout.tree, env:selected.env, encoding: "utf8" });
      if (wide.status !== 0) throw new Error(`owed.mjs's WIDE at ${commit.slice(0, 12)}: ${wide.stderr.trim()}`);
      rmSync(setup, { recursive: true, force: true });
      return { all: list.stdout.split("\n").filter(Boolean), wide: JSON.parse(wide.stdout) as string[] };
    },
    run(commit, steps, label, lastGreen) {
      if (!steps.length) throw new Error("no steps to run: an empty NTS_GATE_STEPS is every step");
      const run = join(layout.runs, `${label}-${commit.slice(0, 12)}-${stamp()}`);
      log(`measuring ${steps.join(" ")} at ${commit.slice(0, 12)}; logs ${run}`);
      let result:ReturnType<typeof spawnSync>;
      try {
        const file = join(controller, "tooling/gate/times.tsv");
        const ceiling = fullCheckCeiling(lastGreen, steps, existsSync(file) ? readFileSync(file, "utf8") : "");
        result = launch(commit, run, steps, ceiling);
      }
      catch(error) {
        const reason=String(error);log(reason);
        return {commit,run,steps:Object.fromEntries(steps.map(step=>[step,"HELD" as const])),reasons:Object.fromEntries(steps.map(step=>[step,reason])),verdict:"held"};
      }
      if (result.error) log(`pinned.sh did not start: ${result.error.message}`);
      const read = result.status === 124 && !existsSync(join(run, MEASUREMENT_HOLD))
        ? { steps: Object.fromEntries(steps.map(step => [step, "HELD" as const])),
            reasons: Object.fromEntries(steps.map(step => [step, "full check run exceeded its wall ceiling"])) }
        : readSummary(run, commit, steps);
      return { commit, run, ...read, verdict: verdictOf(read.steps) };
    },
  };
}
