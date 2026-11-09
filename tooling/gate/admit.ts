// Run a command once the machine's memory ledger admits it:
//
//   node tooling/gate/admit.ts --bytes <N|8G> [--priority landing|agent|full-check] [--what <label>] -- <command> [args...]
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
// handle of whoever reserved), it runs at once inside that one.
//
// Exit status: the command's; 125 when admit itself fails (usage, the
// ledger, a size that can never fit), 126 when the command cannot be run, 127
// when it is not found. A SIGINT, SIGTERM or SIGHUP while it waits withdraws
// its request, and admit then ends by that signal.
import { accessSync, constants, existsSync, statSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { parseBytes, PRIORITIES, reserve, type Priority } from "./memory-ledger.ts";

const USAGE = "usage: node tooling/gate/admit.ts --bytes <N|8G> [--priority landing|agent|full-check] [--what <label>] -- <command> [args...]";

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

type Options = { bytes: number; priority: Priority; what: string; command: string; args: string[] };

function parse(argv: readonly string[]): Options {
  let bytes: number | undefined, what: string | undefined;
  let priority: Priority = "agent";
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
    } else if (flag === "--priority") {
      const given = value();
      if (!(PRIORITIES as readonly string[]).includes(given)) throw new Refusal(`--priority is one of ${PRIORITIES.join(", ")}, not ${given}`, 125, true);
      priority = given as Priority;
    } else if (flag === "--what") what = value();
    else throw new Refusal(`unknown argument ${arg}; the command goes after --`, 125, true);
  }
  const [command, ...args] = argv.slice(at + 1);
  if (bytes === undefined) throw new Refusal("--bytes is required", 125, true);
  if (command === undefined || command === "") throw new Refusal("no command after --", 125, true);
  return { bytes, priority, what: what ?? [command, ...args].join(" "), command, args };
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

async function main(argv: readonly string[]): Promise<void> {
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
    reservation = await reserve({ bytes: options.bytes, what: options.what, priority: options.priority }, { report: say, signal: waiting.signal });
  } catch (error) {
    if (stoppedBy === undefined) throw error;
    // The request is withdrawn. End by the signal, as the command would have.
    process.removeAllListeners(stoppedBy);
    process.kill(process.pid, stoppedBy);
    return;
  }
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
