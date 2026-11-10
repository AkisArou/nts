// Run a command once the machine's memory ledger admits it, or say what the
// ledger holds:
//
//   node tooling/gate/admit.ts --key <name> [--workers <N>] [--at-most <N|8G>] [--priority ...] [--what <label>] -- <command> [args...]
//   node tooling/gate/admit.ts --bytes <N|8G> [--priority landing|agent|full-check] [--what <label>] -- <command> [args...]
//   node tooling/gate/admit.ts --status [--json]
//
// With `--key`, the command reserves what its earlier runs under that key
// were measured to hold, per worker, in the scheduling history of the target
// it runs against (memory-ledger.ts's `jobSizing`), never more than
// `--at-most` (its own kernel cap, say). Its peak is watched while it runs
// and added to that history once it ends, so its next run reserves by it.
// With `--bytes`, it reserves that much, and nothing is measured.
//
// It waits its turn in the ledger (./memory-ledger.ts), printing a line when
// it starts waiting and one when it is admitted, and then *becomes* the
// command (execve). The command keeps this process's pid and start time, and
// those name the reservation's owner. So the reservation lasts exactly as long
// as the command, however the command ends: the next decision drops it once
// the command has exited. The command receives its signals itself, which no
// wrapper process could promise: a wrapper either drops a signal sent only to
// it, or passes on a second copy of one sent to its whole process group. The
// exit status is the command's own.
//
// Started inside another reservation (NTS_MEMORY_RESERVATION, set by the
// handle of whoever reserved), it runs at once inside that one. Without
// --priority, its priority is NTS_MEMORY_PRIORITY's, else an agent's.
//
// Exit status: the command's; 125 when admit itself fails (usage, the
// ledger, a size that can never fit), 126 when the command cannot be run, 127
// when it is not found. A SIGINT, SIGTERM or SIGHUP while it waits withdraws
// its request, and admit then ends by that signal.
//
// `--status` prints the reservations admitted (what each is for, its
// priority, what it reserved and uses now, its owner and since when, the steps
// or jobs it sized without a measurement of their own, and those that held
// more than they reserved) and the queue in its order (what each request
// asks, and how long it has waited); `--json`, the same as `check.ts status
// --json`'s envelope: version, kind ("memory") and at, numbers as numbers.
import { accessSync, constants, existsSync, statSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { gib, jobSizing, ledgerStatus, parseBytes, PRIORITIES, priorityOf, rankForOom, reserve, watchPeak, type JobSizing, type LedgerStatus, type Priority } from "./memory-ledger.ts";

const USAGE = "usage: node tooling/gate/admit.ts --key <name> [--workers <N>] [--at-most <N|8G>] [--priority landing|agent|full-check] [--what <label>] -- <command> [args...]\n"
  + "       node tooling/gate/admit.ts --bytes <N|8G> [--priority landing|agent|full-check] [--what <label>] -- <command> [args...]\n"
  + "       node tooling/gate/admit.ts --status [--json]";

class Refusal extends Error {
  status: number;
  usage: boolean;
  constructor(message: string, status: number, usage = false) {
    super(message);
    this.status = status;
    this.usage = usage;
  }
}

// To fd 2 itself, never through process.stderr: on a pipe, that stream would
// set O_NONBLOCK on the descriptor, and the command inherits the descriptor.
function say(line: string): void {
  try { writeSync(2, `${line}\n`); } catch { /* there is nowhere left to say it */ }
}

type Options = { bytes: number; job: (JobSizing & { key: string }) | null; priority: Priority; what: string; command: string; args: string[] };

function parse(argv: readonly string[]): Options {
  let bytes: number | undefined, what: string | undefined, key: string | undefined, workers: number | undefined, atMost: number | undefined;
  let priority: Priority | undefined;
  let at = 0;
  for (; at < argv.length && argv[at] !== "--"; at++) {
    const arg = argv[at]!, equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = equals > 0 ? arg.slice(0, equals) : arg;
    const value = (): string => {
      const given = equals > 0 ? arg.slice(equals + 1) : argv[++at];
      if (given === undefined) throw new Refusal(`${flag} needs a value`, 125, true);
      return given;
    };
    if (flag === "--bytes") {
      try { bytes = parseBytes(value()); } catch (error) { throw new Refusal((error as Error).message, 125, true); }
    } else if (flag === "--at-most") {
      try { atMost = parseBytes(value()); } catch (error) { throw new Refusal((error as Error).message, 125, true); }
    } else if (flag === "--key") key = value();
    else if (flag === "--workers") {
      const given = value();
      if (!/^[1-9]\d*$/.test(given) || !Number.isSafeInteger(Number(given))) throw new Refusal(`--workers is a positive whole number, not ${given}`, 125, true);
      workers = Number(given);
    } else if (flag === "--priority") {
      const given = value();
      if (!(PRIORITIES as readonly string[]).includes(given)) throw new Refusal(`--priority is one of ${PRIORITIES.join(", ")}, not ${given}`, 125, true);
      priority = given as Priority;
    } else if (flag === "--what") what = value();
    else throw new Refusal(`unknown argument ${arg}; the command goes after --`, 125, true);
  }
  const [command, ...args] = argv.slice(at + 1);
  if ((bytes === undefined) === (key === undefined)) throw new Refusal("one of --key and --bytes says what to reserve", 125, true);
  if (key === undefined && (workers !== undefined || atMost !== undefined)) throw new Refusal("--workers and --at-most size a --key", 125, true);
  if (command === undefined || command === "") throw new Refusal("no command after --", 125, true);
  try { priority ??= priorityOf(process.env); } catch (error) { throw new Refusal((error as Error).message, 125); }
  let job: Options["job"] = null;
  if (key !== undefined) {
    try { job = { key, ...jobSizing({ key, units: workers, atMostBytes: atMost }) }; }
    catch (error) { throw new Refusal((error as Error).message, 125, error instanceof TypeError); }
  }
  return { bytes: job?.bytes ?? bytes!, job, priority, what: what ?? [command, ...args].join(" "), command, args };
}

const runnable = (file: string) => {
  try { if (!statSync(file).isFile()) return false; accessSync(file, constants.X_OK); return true; }
  catch { return false; }
};

/** The file execvp would run for `command`, found before anything waits for it. */
function locate(command: string): string {
  if (command.includes("/")) {
    const file = resolve(command);
    if (runnable(file)) return file;
    throw existsSync(file) ? new Refusal(`${command}: not an executable file`, 126) : new Refusal(`${command}: no such file`, 127);
  }
  let seen = false;
  for (const dir of (process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin").split(":")) {
    const file = resolve(dir || ".", command);
    if (runnable(file)) return file;
    seen ||= existsSync(file);
  }
  throw seen ? new Refusal(`${command}: not executable`, 126) : new Refusal(`${command}: command not found`, 127);
}

/**
 * The admitted reservations, each one that draws on another beneath it,
 * indented, with its share of that one.
 */
function admittedRows(admitted: LedgerStatus["admitted"], clock: (iso: string) => string): string[] {
  const ids = new Set(admitted.map(entry => entry.id)), beneath = new Map<string, LedgerStatus["admitted"]>();
  for (const entry of admitted) if (entry.draws_on !== null && ids.has(entry.draws_on)) beneath.set(entry.draws_on, [...beneath.get(entry.draws_on) ?? [], entry]);
  const rows: string[] = [], shown = new Set<string>();
  const show = (entry: LedgerStatus["admitted"][number], depth: number) => {
    if (shown.has(entry.id)) return;
    shown.add(entry.id);
    const pad = "  ".repeat(depth);
    rows.push(`    ${pad}${entry.priority.padEnd(10)} ${gib(entry.bytes).padStart(10)}, using ${gib(entry.used_bytes).padStart(10)}  `
      + `pid ${entry.owner_pid}  since ${clock(entry.since)}${entry.live ? "" : "  (its owner has exited)"}  ${entry.what}`
      + (entry.drawn_bytes ? `\n      ${pad}drew ${gib(entry.drawn_bytes)} of it on the reservation above` : "")
      + (entry.unmeasured.length ? `\n      ${pad}unmeasured (sized by the largest of its kind, or its share of the machine): ${entry.unmeasured.join(" ")}` : "")
      + (entry.over.length ? `\n      ${pad}over (held more than it reserved): ${entry.over.join(" ")}` : ""));
    for (const child of beneath.get(entry.id) ?? []) show(child, depth + 1);
  };
  for (const entry of admitted) if (entry.draws_on === null || !ids.has(entry.draws_on)) show(entry, 0);
  // Anything left (a loop no ledger writes) is shown flat.
  for (const entry of admitted) show(entry, 0);
  return rows;
}

/** The ledger's state as a person reads it. */
function describeStatus(status: LedgerStatus): string {
  const { machine } = status;
  const clock = (iso: string) => iso.slice(11, 19);
  const lines = [
    `memory ledger ${status.ledger} at ${status.at}`,
    `  machine: ${gib(machine.total_bytes)}, ${gib(machine.available_bytes)} available; ${gib(status.pending_bytes)} promised to running jobs, `
      + `${gib(machine.floor_bytes)} kept for the system; room for ${gib(Math.max(0, status.room_bytes))}`,
    `  admitted (${status.admitted.length})${status.admitted.length ? ":" : ": none"}`,
    ...admittedRows(status.admitted, clock),
    `  waiting (${status.waiting.length})${status.waiting.length ? ":" : ": none"}`,
    ...status.waiting.map((entry, at) => `    ${String(at + 1).padStart(2)}. ${entry.priority.padEnd(10)} ${entry.grows === null ? "" : "grows by "}${gib(entry.bytes)}  `
      + `waited ${Math.round(entry.waited_s)} s  pid ${entry.waiter_pid}${entry.live ? "" : "  (gone)"}  ${entry.what}`),
  ];
  return lines.join("\n") + "\n";
}

function status(argv: readonly string[]): void {
  const extra = argv.filter(arg => arg !== "--status" && arg !== "--json");
  if (extra.length) throw new Refusal(`--status takes only --json, not ${extra.join(" ")}`, 125, true);
  const state = ledgerStatus();
  // To fd 1 itself, as `say` writes fd 2: a status reader may be a pipe.
  writeSync(1, argv.includes("--json") ? `${JSON.stringify(state, null, 2)}\n` : describeStatus(state));
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv[0] === "--status") return status(argv);
  const options = parse(argv);
  const file = locate(options.command);
  const execve = process.execve?.bind(process);
  if (execve === undefined) throw new Refusal(`node ${process.version} cannot become another program (process.execve)`, 125);
  // Node ignores SIGPIPE and SIGXFSZ, and execve keeps a signal ignored while
  // it returns a caught one to its default. Catching both here gives the
  // command the dispositions it would have had had it been started directly.
  for (const signal of ["SIGPIPE", "SIGXFSZ"] as const) process.on(signal, () => {});
  const waiting = new AbortController();
  let stoppedBy: NodeJS.Signals | undefined;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => { stoppedBy ??= signal; waiting.abort(); });
  }
  let reservation: Awaited<ReturnType<typeof reserve>>;
  try {
    reservation = await reserve({ bytes: options.bytes, what: options.what, priority: options.priority,
      unmeasured: options.job && options.job.basis !== "measured" ? [options.job.key] : [] }, { report: say, signal: waiting.signal });
  } catch (error) {
    if (stoppedBy === undefined) throw error;
    // The request is withdrawn. End by the signal, as the command would have.
    process.removeAllListeners(stoppedBy);
    process.kill(process.pid, stoppedBy);
    return;
  }
  // Watched from outside: this process becomes the command, ranked for the
  // OOM killer by its priority (memory-ledger.ts's OOM_SCORE).
  if (options.job && !reservation.inherited) watchPeak(reservation, options.job, say);
  rankForOom(options.priority, say);
  const env = { ...process.env, ...reservation.env };
  let failure: unknown;
  try { execve(file, [options.command, ...options.args], env); }
  catch (error) { failure = error; }
  if ((failure as NodeJS.ErrnoException).code === "ENOEXEC") {
    // A script without an interpreter line: what execvp does, the shell runs it.
    try { execve("/bin/sh", ["sh", file, ...options.args], env); }
    catch (error) { failure = error; }
  }
  reservation.release();
  throw new Refusal(`cannot run ${options.command}: ${(failure as Error).message}`, 126);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  say(`admit: ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof Refusal && error.usage) say(USAGE);
  process.exitCode = error instanceof Refusal ? error.status : 125;
});
