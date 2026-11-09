// Work the full check starts in the background (docs/workflow.md, "After
// landing: the full check"): each piece runs in a systemd user unit of its own,
// named for its kind of work, so it outlives the controller that started it
// and the controller goes on with the core while it runs. A part's records run
// is one (service.ts); the nightly benchmark run is meant to be the next.
//
// The controller writes the job -- its unit's name and the file its outcome
// goes to -- into its state before the unit exists, and reads the outcome once
// the unit is gone. A controller that restarts finds the work by that name:
//
//   running                 it waits: a second unit of that name cannot start;
//   gone, with an outcome   the work ended, and the outcome says how;
//   gone, without one       the work stopped before it finished (stopped by
//                           hand, killed, the machine restarted): it is started
//                           once more (STARTS), and then it is given up.
//
// The work writes its outcome itself, whole, as its last act (writeOutcome),
// so an outcome is always all of one run's and never half of one. It runs the
// code of a tree that only it uses while it runs, never the controller's: the
// controller's tree moves to `verified` under it (service.ts's followVerified),
// and a process that reads a tree while it moves reads two versions of it.
//
// systemdUnits() starts each one with `systemd-run --user --unit=<name>
// --collect`: --collect unloads a unit when it ends, failed or not, so its
// name is free again and `running` says false. A unit is stopped by its name,
// `systemctl --user stop <name>`, never by a PID.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { systemdEnvironment } from "../gate/environment.ts";
import { toolingSliceArgs } from "../gate/tooling-slice.ts";

/** One unit: its name, the tree it works in and whose code it runs, its command, and the file its output goes to. */
export type UnitSpec = {
  /** The unit's name, without `.service`: one name for one kind of work, so a second cannot start while it runs. */
  name: string;
  cwd: string;
  command: readonly string[];
  /** Its standard output and error, appended. */
  log: string;
};

export type Units = {
  /** Start a unit of `spec`; null when it started, else why not (a unit of that name already loaded, say). */
  start(spec: UnitSpec): string | null;
  /** Whether a unit of that name is loaded: starting, running or stopping. Throws when that cannot be told. */
  running(name: string): boolean;
};

/** A piece of background work as the controller's state records it. */
export type Job = {
  unit: string;
  /** The file the work writes its outcome to, as its last act. */
  outcome: string;
  /** When it was last started. */
  at: string;
  /** How many times it was started, this time included. */
  starts: number;
  /** When its outcome was read. */
  ended?: string;
};

/** How many times a job is started: once, and once more after a unit that was gone without an outcome. */
export const STARTS = 2;

/** What every outcome says: when the work ended, and its exit status. Each kind of work adds its own fields. */
export type Outcome = { version: 1; at: string; status: number };

/** The outcome, whole: written beside itself and renamed into place, so a reader finds all of it or nothing. */
export function writeOutcome<T extends object>(file: string, value: T & { status: number }, at = new Date()): void {
  mkdirSync(dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.partial`;
  writeFileSync(partial, `${JSON.stringify({ version: 1, at: at.toISOString(), ...value }, null, 2)}\n`);
  renameSync(partial, file);
}

/** The outcome a job wrote, or null when it wrote none. */
export function readOutcome<T extends object = object>(file: string): (Outcome & T) | null {
  if (!existsSync(file)) return null;
  const value = JSON.parse(readFileSync(file, "utf8")) as Outcome & T;
  if (value.version !== 1 || typeof value.status !== "number") throw new Error(`${file}: not an outcome of version 1`);
  return value;
}

/** The job of the unit named `unit`, started now for the first time; its outcome goes to `outcome`. */
export function newJob(unit: string, outcome: string, at: Date): Job {
  return { unit, outcome, at: at.toISOString(), starts: 1 };
}

/**
 * Start `job`'s unit. Its earlier outcome goes first, so the one read later is
 * this run's; then the job is saved where the controller keeps it (`save`),
 * before the unit exists, so a controller that stops in between finds the
 * unit by its name. Null when the unit started, else why not.
 */
export function start(units: Units, spec: UnitSpec, job: Job, save: () => void): string | null {
  if (spec.name !== job.unit) throw new Error(`the job is ${job.unit}'s, not ${spec.name}'s`);
  rmSync(job.outcome, { force: true });
  save();
  try { return units.start(spec); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
}

export type Seen<T extends object> =
  | { state: "running" }
  | { state: "ended"; outcome: Outcome & T }
  /** Gone without an outcome it can read, and why; `again` when it may be started once more (startAgain). */
  | { state: "lost"; why: string; again: boolean };

/** What a job is now, by its unit's name. An ended job is marked so. */
export function look<T extends object = object>(job: Job, units: Units, now: Date): Seen<T> {
  if (units.running(job.unit)) return { state: "running" };
  let outcome: (Outcome & T) | null;
  // An outcome is written whole, so one that cannot be read was damaged after:
  // the work ended, and running it again would not tell how.
  try { outcome = readOutcome<T>(job.outcome); }
  catch (error) { return { state: "lost", why: `its outcome cannot be read: ${error instanceof Error ? error.message : String(error)}`, again: false }; }
  if (!outcome) return { state: "lost", why: `${job.unit} is gone and wrote no outcome`, again: job.starts < STARTS };
  job.ended = now.toISOString();
  return { state: "ended", outcome };
}

/** A lost job started once more (start), never more than STARTS times in all. */
export function startAgain(units: Units, spec: UnitSpec, job: Job, now: Date, save: () => void): string | null {
  if (job.starts >= STARTS) throw new Error(`${job.unit} was started ${job.starts} times already`);
  job.starts += 1;
  job.at = now.toISOString();
  return start(units, spec, job, save);
}

/** `systemctl show`'s KEY=value lines. */
function shown(text: string): Record<string, string> {
  return Object.fromEntries(text.split("\n").filter(line => line.includes("=")).map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
}

/**
 * The user manager's units. Each is started with `properties` (unit.ts's
 * lowPriority), the gate's host capabilities from `env` and its working
 * directory, as Type=exec, so a command that cannot start fails its start.
 * Inside a tooling run it joins that run's slice, which stops it with the run.
 */
export function systemdUnits(properties: readonly string[], env: NodeJS.ProcessEnv = process.env): Units {
  return {
    start(spec) {
      const r = spawnSync("systemd-run", [
        "--user", `--unit=${spec.name}`, "--collect", "--quiet", ...toolingSliceArgs(env),
        "--property=Type=exec", ...properties.map(property => `--property=${property}`),
        `--property=StandardOutput=append:${spec.log}`, `--property=StandardError=append:${spec.log}`,
        `--working-directory=${spec.cwd}`, ...systemdEnvironment(env), "--", ...spec.command,
      ], { encoding: "utf8" });
      if (r.error) return `systemd-run: ${r.error.message}`;
      return r.status === 0 ? null : `systemd-run exited ${r.status}: ${r.stderr.trim()}`;
    },
    running(name) {
      const r = spawnSync("systemctl", ["--user", "show", `${name}.service`, "--property=LoadState", "--property=ActiveState"], { encoding: "utf8" });
      if (r.error || r.status !== 0) throw new Error(`systemctl --user show ${name}.service: ${r.error?.message ?? r.stderr.trim()}`);
      const unit = shown(r.stdout);
      return unit.LoadState === "loaded" && unit.ActiveState !== "inactive" && unit.ActiveState !== "failed";
    },
  };
}
