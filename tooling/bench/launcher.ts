// The one launch timer's TypeScript side: it builds launch.c, hands it one
// sitting's columns under one canonical environment and cwd, and reads back
// typed launch observations (tooling/bench/README.md, "Launch rows"). A
// missing, short or malformed observation is a ToolingInstrumentError, never
// a value. launch-cell.ts says what the observations mean as cells.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fileInput } from "../gate/reader-inputs/main.ts";
import { ToolingInstrumentError } from "../gate/step-result.ts";
import { LAUNCH_PROTOCOL, type Launch, type LaunchDetails } from "./launch-cell.ts";

export const LAUNCH_SOURCE = fileInput(new URL("./launch.c", import.meta.url));
/** A launch's own bounds: past either it is a recorded TIMED_OUT or a CPU-limit kill. */
export const LAUNCH_CPU_SECONDS = 120;
export const LAUNCH_WALL_SECONDS = 180;

const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const instrument = (message: string) => new ToolingInstrumentError("tooling-setup", `launch timer: ${message}`);

/** The compiled timer and the digest of the source it was built from. */
export type Launcher = { binary: string; sourceSha256: string };

/** Builds the timer into `directory`, with clang, on the CPUs a build may use. */
export function buildLauncher(directory: string, cpus: string): Launcher {
  const source = fileURLToPath(LAUNCH_SOURCE);
  mkdirSync(directory, { recursive: true });
  const binary = join(directory, "nts-launch");
  const built = spawnSync("taskset", ["-c", cpus, "clang", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", source, "-o", binary], { encoding: "utf8" });
  if (built.status !== 0) throw instrument(`cannot build ${source}: ${built.error?.message ?? built.stderr}`);
  return { binary, sourceSha256: sha256(readFileSync(source)) };
}

/**
 * Every column of a sitting launches with exactly this environment: no
 * inherited variable, so nothing of ours turns on a comparator's cache
 * (`NODE_COMPILE_CACHE`, `NODE_OPTIONS`, Bun's settings stay their defaults),
 * and an empty home and temporary directory of the sitting's own.
 */
export function launchEnvironment(directory: string, extra: Record<string, string> = {}): Record<string, string> {
  const home = join(directory, "home"), temporary = join(directory, "tmp");
  mkdirSync(home, { recursive: true });
  mkdirSync(temporary, { recursive: true });
  return { HOME: home, LANG: "C.UTF-8", PATH: "/usr/bin:/bin", TMPDIR: temporary, TZ: "UTC", ...extra };
}
export function environmentDigest(environment: Record<string, string>): string {
  return sha256(Object.keys(environment).sort().map(key => `${key}=${environment[key]}\0`).join(""));
}

export type LaunchColumn = { label: string; argv: string[] };
export type LaunchRequest = {
  launcher: Launcher; cpu: number; cwd: string; environment: Record<string, string>;
  columns: LaunchColumn[]; warmups: number; launches: number; out: string;
  /** Each launch's bounds; a sitting uses LAUNCH_CPU_SECONDS and LAUNCH_WALL_SECONDS. */
  bounds?: { cpuSeconds: number; wallSeconds: number };
};
/** One column's sitting: its launches, the stdout they agreed on, and the first failing launch's stderr. */
export type ColumnLaunches = { label: string; argv: string[]; details: LaunchDetails; stdout: string; stderr: string };
export type Sitting = { protocol: typeof LAUNCH_PROTOCOL; cwd: string; environment: Record<string, string>;
  environmentSha256: string; launcherSha256: string; cpu: number; columns: ColumnLaunches[] };

/** Parses the timer's output strictly; `read` supplies each launch's stdout and stderr bytes. */
export function parseLaunches(text: string, request: Omit<LaunchRequest, "launcher" | "out" | "bounds">,
  read: (column: number, round: number, stream: "stdout" | "stderr") => Buffer): ColumnLaunches[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const rounds = request.warmups + request.launches, total = rounds * request.columns.length;
  if (lines[0] !== `nts-launch 1 cpu=${request.cpu} columns=${request.columns.length} rounds=${rounds}`) throw instrument(`unexpected header: ${lines[0] ?? "(none)"}`);
  if (lines.length !== total + 2 || lines.at(-1) !== `end ${total}`) throw instrument(`expected ${total} launches, read ${Math.max(0, lines.length - 2)}`);
  const environmentSha256 = environmentDigest(request.environment);
  const seen = request.columns.map(() => ({ warmups: [] as Launch[], launches: [] as Launch[], stdouts: new Map<string, string>(), stderr: "" }));
  for (const line of lines.slice(1, -1)) {
    const match = /^L (\d+) (\d+) ([01]) (\d+) ([01]) (-?\d+) ([01]) (\d+) (\d+) (\d+)$/.exec(line);
    if (!match) throw instrument(`malformed launch line: ${line}`);
    const [column, round, warm, wall, exited, code, timedOut, user, system, rss] = match.slice(1).map(Number) as number[];
    if (column! >= request.columns.length || round! >= rounds || (warm === 1) !== (round! < request.warmups)) throw instrument(`launch out of its sitting: ${line}`);
    if (code! < 0) throw instrument(`launch ended neither by exit nor by signal: ${line}`);
    const stdout = read(column!, round!, "stdout"), stdoutSha256 = sha256(stdout);
    const launch: Launch = { wallNanoseconds: wall!, status: exited === 1 ? code! : null, signal: exited === 1 ? null : code!,
      timedOut: timedOut === 1, userMicroseconds: user!, systemMicroseconds: system!, maxRssKib: rss!, stdoutSha256 };
    if (!Number.isSafeInteger(launch.wallNanoseconds) || launch.wallNanoseconds <= 0) throw instrument(`launch time is not positive: ${line}`);
    const state = seen[column!]!;
    (warm === 1 ? state.warmups : state.launches).push(launch);
    state.stdouts.set(stdoutSha256, stdout.toString("utf8"));
    if (!state.stderr && (launch.status !== 0 || launch.timedOut)) state.stderr = read(column!, round!, "stderr").toString("utf8").slice(0, 4096);
  }
  return request.columns.map((column, index) => {
    const state = seen[index]!;
    if (state.warmups.length !== request.warmups || state.launches.length !== request.launches) throw instrument(`column ${column.label} is missing launches`);
    // The column's stdout is the first timed launch's; launch-cell.ts holds every launch to it.
    const stdoutSha256 = state.launches[0]!.stdoutSha256;
    return { label: column.label, argv: column.argv, stdout: state.stdouts.get(stdoutSha256)!, stderr: state.stderr,
      details: { protocol: LAUNCH_PROTOCOL, warmups: state.warmups, launches: state.launches, stdoutSha256, environmentSha256 } };
  });
}

/** One sitting: every column launched in rotating rounds by the compiled timer. */
export async function launchSitting(request: LaunchRequest): Promise<Sitting> {
  if (!isAbsolute(request.cwd) || !isAbsolute(request.out)) throw instrument("cwd and output must be absolute");
  for (const column of request.columns) if (!column.argv[0] || !isAbsolute(column.argv[0])) throw instrument(`column ${column.label} needs an absolute program`);
  rmSync(request.out, { recursive: true, force: true });
  const outputs = join(request.out, "launches");
  mkdirSync(outputs, { recursive: true });
  const environmentFile = join(request.out, "environment"), columnsFile = join(request.out, "columns");
  writeFileSync(environmentFile, Object.keys(request.environment).sort().map(key => `${key}=${request.environment[key]}\0`).join(""));
  writeFileSync(columnsFile, request.columns.map(column => [column.label, String(column.argv.length), ...column.argv].map(part => `${part}\0`).join("")).join(""));
  const bounds = request.bounds ?? { cpuSeconds: LAUNCH_CPU_SECONDS, wallSeconds: LAUNCH_WALL_SECONDS };
  const args = ["--cpu", String(request.cpu), "--cpu-seconds", String(bounds.cpuSeconds), "--wall-seconds", String(bounds.wallSeconds),
    "--warmups", String(request.warmups), "--launches", String(request.launches), "--cwd", request.cwd,
    "--env", environmentFile, "--columns", columnsFile, "--out", outputs];
  const { status, stdout, stderr } = await new Promise<{ status: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(request.launcher.binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", bytes => (out += bytes));
    child.stderr.on("data", bytes => (err += bytes));
    child.on("error", reject);
    child.on("close", code => done({ status: code, stdout: out, stderr: err }));
  });
  if (status !== 0) throw instrument(`exited ${status}: ${stderr.trim() || "(no reason)"}`);
  const columns = parseLaunches(stdout, request, (column, round, stream) => readFileSync(join(outputs, `${column}-${round}.${stream}`)));
  return { protocol: LAUNCH_PROTOCOL, cwd: request.cwd, environment: request.environment, environmentSha256: environmentDigest(request.environment),
    launcherSha256: request.launcher.sourceSha256, cpu: request.cpu, columns };
}
