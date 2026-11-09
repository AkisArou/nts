// The full check's systemd user units: the controller, one long-running
// service at low priority from a controller worktree of its own at `verified`;
// the hourly count, a service its own timer starts; and each part's records
// unit, which the controller starts itself (service.ts, background.ts) and so
// is not installed.
//
//   node tooling/full-check/unit.ts                  print the controller's unit, and the count's service and timer
//   node tooling/full-check/unit.ts --install        make the controller tree and link its inputs, write the three, reload systemd
//   options: --wide-at=10:00,16:00,22:00 --nightly-at=03:00 --memory-high=20G
//
// Then `systemctl --user enable --now nts-full-check` starts the controller,
// `systemctl --user enable --now nts-full-check-count.timer` the count, and
// `journalctl --user -u nts-full-check -f` follows the controller.
// `systemctl --user stop nts-full-check` stops it and every process it
// started (the unit's cgroup), except the records units, which run on and are
// adopted by name when it starts again: `systemctl --user stop
// nts-full-check-records-core` stops one. The schedule lives on the
// controller's ExecStart line: edit it with `--install` and new options, or
// `systemctl --user edit --full nts-full-check`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FIXED_AMBIENT, hostEnvironment } from "../gate/canonical-environment.ts";
import { sharedCheckout } from "../landing/git.ts";
import { linkInputs } from "../landing/pool.ts";
import { DEFAULT_SCHEDULE, parseTimes, type Schedule } from "./schedule.ts";
import { layout as defaultLayout, type Layout, type Part } from "./state.ts";

export const UNIT = "nts-full-check";
/** The hourly count's service, and the timer of that name that starts it (service.ts --count). */
export const COUNT_UNIT = `${UNIT}-count`;
/** A part's records unit (service.ts): one name for each part, so a second cannot start while one runs. */
export const recordsUnitName = (part: Part) => `${UNIT}-records-${part}`;

/**
 * How every unit of the full check runs: landing checks and agents come first,
 * so the lowest priority and a small CPU and IO weight; the measurement CPUs
 * 4-5 excluded; the first to go when the machine runs out of memory; and no
 * core dumps of the gate's deliberate crashes stored.
 */
export function lowPriority(cpus = "0-3 6-31"): string[] {
  return ["Nice=19", "CPUWeight=20", "IOWeight=20", `CPUAffinity=${cpus}`, "OOMScoreAdjust=500", "LimitCORE=0"];
}

export type UnitOptions = { node: string; layout: Layout; schedule: Schedule; memoryHigh: string; env: NodeJS.ProcessEnv };

/** A systemd unit-file value: quoted, with `%` (a specifier) and quotes escaped. */
const quote = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
/** An ExecStart argument, where `$` also expands a variable. */
const argument = (value: string) => quote(value).replaceAll("$", "$$$$");

/** The gate's host capabilities, as the controller and the count are given them. */
const environment = (env: NodeJS.ProcessEnv) =>
  Object.entries({ ...hostEnvironment(env), ...FIXED_AMBIENT }).filter(([, value]) => value).map(([name, value]) => `Environment=${quote(`${name}=${value}`)}`);

export function unitText(options: UnitOptions): string {
  const { layout, schedule } = options;
  const exec = [options.node, join(layout.controller, "tooling/full-check/service.ts"), `--wide-at=${schedule.wide.join(",")}`, `--nightly-at=${schedule.nightly}`];
  return [
    "[Unit]",
    "Description=nts full check: the core on the newest main, the wide steps on verified",
    "After=default.target",
    "",
    "[Service]",
    "Type=simple",
    // A path, not a quoted word: systemd takes it as written, specifiers aside.
    `WorkingDirectory=${layout.controller.replaceAll("%", "%%")}`,
    `ExecStart=${exec.map(argument).join(" ")}`,
    "Restart=always",
    "RestartSec=60",
    ...lowPriority(),
    `MemoryHigh=${options.memoryHigh}`,
    "KillMode=control-group",
    "TimeoutStopSec=120",
    ...environment(options.env),
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

/**
 * The count's service: service.ts --count once, from the controller's tree,
 * holding that tree's lock shared while it reads it, so the controller never
 * moves the tree to `verified` under it (service.ts's followVerified). A count
 * that hangs is stopped after half an hour, and the next hour counts again.
 */
export function countServiceText(options: Pick<UnitOptions, "node" | "layout" | "env">): string {
  const { layout } = options;
  const exec = ["flock", "--shared", layout.controllerLock, options.node, join(layout.controller, "tooling/full-check/service.ts"), "--count"];
  return [
    "[Unit]",
    "Description=nts full check: the hourly count of branches, worktrees and ~/.cache, after the pool's upkeep",
    "",
    "[Service]",
    "Type=oneshot",
    `WorkingDirectory=${layout.controller.replaceAll("%", "%%")}`,
    `ExecStart=${exec.map(argument).join(" ")}`,
    "TimeoutStartSec=30min",
    ...lowPriority(),
    ...environment(options.env),
    "",
  ].join("\n");
}

/** The count's timer: hourly, and at once after an hour the machine was off or the timer stopped (Persistent). */
export function countTimerText(): string {
  return [
    "[Unit]",
    "Description=nts full check: the count, hourly",
    "",
    "[Timer]",
    "OnCalendar=hourly",
    "Persistent=true",
    `Unit=${COUNT_UNIT}.service`,
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

export function parseUnitOptions(argv: readonly string[]): { install: boolean; schedule: Schedule; memoryHigh: string } {
  const schedule = { ...DEFAULT_SCHEDULE };
  let install = false, memoryHigh = "20G";
  for (const arg of argv) {
    if (arg === "--install") install = true;
    else if (arg.startsWith("--wide-at=")) schedule.wide = parseTimes(arg.slice(10));
    else if (arg.startsWith("--nightly-at=")) {
      const [nightly, ...rest] = parseTimes(arg.slice(13));
      if (!nightly || rest.length) throw new Error("--nightly-at takes one time of day");
      schedule.nightly = nightly;
    } else if (/^--memory-high=\d+[KMGT]$/.test(arg)) memoryHigh = arg.slice(14);
    else throw new Error(`unknown argument ${arg}; usage: unit.ts [--install] [--wide-at=HH:MM,...] [--nightly-at=HH:MM] [--memory-high=20G]`);
  }
  return { install, schedule, memoryHigh };
}

function run(command: string, args: string[], cwd: string): string {
  const r = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (r.error || r.status !== 0) throw new Error(`${command} ${args.join(" ")}: ${r.error?.message ?? r.stderr.trim()}`);
  return r.stdout.trim();
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseUnitOptions(process.argv.slice(2));
    const layout = defaultLayout(), unitOptions = { node: process.execPath, layout, schedule: options.schedule, memoryHigh: options.memoryHigh, env: process.env };
    const files: [string, string][] = [
      [`${UNIT}.service`, unitText(unitOptions)], [`${COUNT_UNIT}.service`, countServiceText(unitOptions)], [`${COUNT_UNIT}.timer`, countTimerText()],
    ];
    if (!options.install) process.stdout.write(files.map(([name, text]) => `# ${name}\n${text}`).join("\n"));
    else {
      const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
      if (!existsSync(join(layout.controller, ".git"))) {
        const start = spawnSync("git", ["rev-parse", "--verify", "--quiet", "refs/heads/verified"], { cwd: root }).status === 0 ? "verified" : "main";
        mkdirSync(layout.home, { recursive: true });
        run("git", ["worktree", "add", "--detach", "-q", layout.controller, start], root);
        console.log(`controller tree: ${layout.controller} at ${start}`);
      }
      // The service launches gates from this tree, so it has the inputs no
      // commit carries (inputs.sh), made again on every install.
      linkInputs(sharedCheckout(root))(layout.controller);
      const dir = join(homedir(), ".config/systemd/user");
      mkdirSync(dir, { recursive: true });
      for (const [name, text] of files) writeFileSync(join(dir, name), text);
      run("systemctl", ["--user", "daemon-reload"], root);
      console.log([
        `wrote ${files.map(([name]) => join(dir, name)).join(", ")}`,
        `start the controller: systemctl --user enable --now ${UNIT}`,
        `start the hourly count: systemctl --user enable --now ${COUNT_UNIT}.timer`,
        `follow the controller: journalctl --user -u ${UNIT} -f`,
      ].join("\n"));
    }
  } catch (error) {
    console.error(`unit: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
