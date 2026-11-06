// The full check's systemd user unit: one long-running service at low
// priority, from a controller worktree of its own at `verified`.
//
//   node tooling/full-check/unit.ts                  print the unit
//   node tooling/full-check/unit.ts --install        make the controller tree, write the unit, reload systemd
//   options: --wide-at=10:00,16:00,22:00 --nightly-at=03:00 --memory-high=20G
//
// Then `systemctl --user enable --now nts-full-check` starts it, `journalctl
// --user -u nts-full-check -f` follows it, and `systemctl --user stop
// nts-full-check` stops it and every process it started (the unit's cgroup).
// The schedule lives on the ExecStart line: edit it with `--install` and new
// options, or `systemctl --user edit --full nts-full-check`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FIXED_AMBIENT, hostEnvironment } from "../gate/canonical-environment.ts";
import { DEFAULT_SCHEDULE, parseTimes, type Schedule } from "./schedule.ts";
import { layout as defaultLayout, type Layout } from "./state.ts";

export const UNIT = "nts-full-check";

export type UnitOptions = { node: string; layout: Layout; schedule: Schedule; memoryHigh: string; env: NodeJS.ProcessEnv };

/** A systemd unit-file value: quoted, with `%` (a specifier) and quotes escaped. */
const quote = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
/** An ExecStart argument, where `$` also expands a variable. */
const argument = (value: string) => quote(value).replaceAll("$", "$$$$");

export function unitText(options: UnitOptions): string {
  const { layout, schedule } = options;
  const environment = { ...hostEnvironment(options.env), ...FIXED_AMBIENT };
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
    // Landing checks come first: the lowest priority, a small CPU and IO
    // weight, the measurement CPUs 4-5 excluded, and the first to go when the
    // machine runs out of memory.
    "Nice=19",
    "CPUWeight=20",
    "IOWeight=20",
    "CPUAffinity=0-3 6-31",
    `MemoryHigh=${options.memoryHigh}`,
    "OOMScoreAdjust=500",
    // The gate's deliberate crashes store no core dumps.
    "LimitCORE=0",
    "KillMode=control-group",
    "TimeoutStopSec=120",
    ...Object.entries(environment).filter(([, value]) => value).map(([name, value]) => `Environment=${quote(`${name}=${value}`)}`),
    "",
    "[Install]",
    "WantedBy=default.target",
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
    const layout = defaultLayout();
    const text = unitText({ node: process.execPath, layout, schedule: options.schedule, memoryHigh: options.memoryHigh, env: process.env });
    if (!options.install) process.stdout.write(text);
    else {
      const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
      if (!existsSync(join(layout.controller, ".git"))) {
        const start = spawnSync("git", ["rev-parse", "--verify", "--quiet", "refs/heads/verified"], { cwd: root }).status === 0 ? "verified" : "main";
        mkdirSync(layout.home, { recursive: true });
        run("git", ["worktree", "add", "--detach", "-q", layout.controller, start], root);
        console.log(`controller tree: ${layout.controller} at ${start}`);
      }
      const file = join(homedir(), ".config/systemd/user", `${UNIT}.service`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
      run("systemctl", ["--user", "daemon-reload"], root);
      console.log(`wrote ${file}\nstart it: systemctl --user enable --now ${UNIT}\nfollow it: journalctl --user -u ${UNIT} -f`);
    }
  } catch (error) {
    console.error(`unit: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
