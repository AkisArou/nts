// One case's command under the shared supervisor (active-command.ts), for a
// runner written in shell or a tool that runs one command at a time.
//
//   node tooling/gate/case-bound.ts [--compile | --build] [--cpu <s>] [--idle <s>] -- <command> [argument ...]
//
//   --compile  the command is a case's compile: past COMPILE_CPU_BOUND_SECONDS
//              of its own CPU it timed out
//   --build    the same compile bound on each process's own CPU, including linkers
//   --cpu      the process group's CPU budget (default COMMAND_CPU_BUDGET_SECONDS)
//   --idle     seconds with no output and no CPU before it is hung (default
//              COMMAND_IDLE_GUARD_MS)
//
// It exits with the command's own status when the command finished, or 128
// plus the signal that ended it. A compile past its bound timed out: that is
// the case's outcome, never a hold, so nothing is published for the step; the
// reason goes to stderr and it exits 125. A command past its CPU budget, one
// that went silent, or an observer that broke measured nothing: the step's
// frame says so (runaway, hung, tooling-setup) and it exits 124, as every
// unmeasured check does.
import { constants } from "node:os";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { activeCommand, COMMAND_ACTIVITY_POLL_MS, COMMAND_CPU_BUDGET_SECONDS, COMMAND_IDLE_GUARD_MS, COMPILE_CPU_BOUND_SECONDS } from "./active-command.ts";
import { publishHung, publishRunaway, publishToolingFailure, ToolingInstrumentError } from "./step-result.ts";

export const CASE_TIMEOUT_EXIT = 125;
export const CASE_UNMEASURED_EXIT = 124;

export type CaseBoundArguments = { ownCpuSeconds?: number; eachProcessCpuSeconds?: number; cpuSeconds: number; idleMs: number; command: string; args: string[] };

export function parseCaseBound(argv: readonly string[]): CaseBoundArguments {
  const rest = [...argv];
  let ownCpuSeconds: number | undefined, eachProcessCpuSeconds: number | undefined, cpuSeconds = COMMAND_CPU_BUDGET_SECONDS, idleMs = COMMAND_IDLE_GUARD_MS;
  const seconds = (flag: string) => {
    const value = Number(rest.shift());
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${flag} needs a positive number of seconds`);
    return value;
  };
  for (;;) {
    const flag = rest.shift();
    if (flag === "--") break;
    if (flag === "--compile") ownCpuSeconds = COMPILE_CPU_BOUND_SECONDS;
    else if (flag === "--build") eachProcessCpuSeconds = COMPILE_CPU_BOUND_SECONDS;
    else if (flag === "--cpu") cpuSeconds = seconds(flag);
    else if (flag === "--idle") idleMs = seconds(flag) * 1000;
    else throw new Error(`usage: case-bound.ts [--compile | --build] [--cpu <s>] [--idle <s>] -- <command> [argument ...]${flag === undefined ? "" : `; unknown argument ${flag}`}`);
  }
  const [command, ...args] = rest;
  if (!command) throw new Error("case-bound.ts needs a command after --");
  return { ...(eachProcessCpuSeconds === undefined ? {} : { eachProcessCpuSeconds }), ...(ownCpuSeconds === undefined ? {} : { ownCpuSeconds }), cpuSeconds, idleMs, command, args };
}

/** Run one bounded case and say how it ended, as an exit status. */
export async function runCaseBound(bound: CaseBoundArguments, env: NodeJS.ProcessEnv = process.env,
  write = { out: (text: string) => { process.stdout.write(text); }, err: (text: string) => { process.stderr.write(text); } }): Promise<number> {
  // The case's own outcome never reaches the step's frame; only a hold does, below.
  const own = { ...env }; delete own.NTS_GATE_STEP_RESULT;
  let result;
  try {
    result = await activeCommand(bound.command, bound.args, { cwd: process.cwd(), env: own, cpuBudgetSeconds: bound.cpuSeconds, idleMs: bound.idleMs,
      pollMs: Math.min(COMMAND_ACTIVITY_POLL_MS, bound.idleMs / 4),
      ...(bound.eachProcessCpuSeconds === undefined ? {} : { eachProcessCpuSeconds: bound.eachProcessCpuSeconds }),
      ...(bound.ownCpuSeconds === undefined ? {} : { ownCpuSeconds: bound.ownCpuSeconds }) });
  } catch (error) {
    const failure = error instanceof ToolingInstrumentError ? error : new ToolingInstrumentError("tooling-setup", `cannot supervise ${bound.command}: ${String(error)}`);
    publishToolingFailure(failure, env);
    write.err(`not measured: ${failure.message}\n`);
    return CASE_UNMEASURED_EXIT;
  }
  write.out(result.stdout); write.err(result.stderr);
  if (result.timeout) { write.err(`timed out: ${result.timeout}\n`); return CASE_TIMEOUT_EXIT; }
  if (result.runaway) { publishRunaway(result.runaway, env); write.err(`not measured: ${result.runaway}\n`); return CASE_UNMEASURED_EXIT; }
  if (result.hung) { publishHung(result.hung, env); write.err(`not measured: ${result.hung}\n`); return CASE_UNMEASURED_EXIT; }
  if (result.error) {
    publishToolingFailure(new ToolingInstrumentError("tooling-setup", `cannot start ${bound.command}: ${result.error.message}`), env);
    write.err(`not measured: cannot start ${bound.command}: ${result.error.message}\n`);
    return CASE_UNMEASURED_EXIT;
  }
  if (result.signal) return 128 + (constants.signals[result.signal] ?? 0);
  return result.status ?? CASE_UNMEASURED_EXIT;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let bound;
  try { bound = parseCaseBound(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exit(2); }
  process.exitCode = await runCaseBound(bound);
}
