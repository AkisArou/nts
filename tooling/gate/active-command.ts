// Activity observation and bounded worker ownership share one command result.
import { activeCommand as observeCommand, type ActiveResult as ProcessResult, type ActiveOptions,COMMAND_STARTUP_BOUND_MS } from "./active-process.ts";
import { CaseBudgetError, PressureError } from "./step-result.ts";
import { commandWorker, type MemoryCause } from "../census/worker-memory.ts";
export * from "./active-process.ts";

export type ActiveResult = ProcessResult & { memory?: { cause: MemoryCause; limitBytes: number } };

export async function activeCommand(command: string, args: readonly string[], options: ActiveOptions): Promise<ActiveResult> {
  const worker = commandWorker(command, args, options.env);
  if (!worker) return observeCommand(command, args, options);
  try {
    const result = await observeCommand("systemd-run", worker.scope.argv, { ...options, env: worker.scope.env, boundedEntry:{startupMs:options.boundedEntry?.startupMs??COMMAND_STARTUP_BOUND_MS,ready:()=>worker.ready()} });
    const memory = worker.observation(result);
    return memory ? { ...result, memory } : result;
  } finally { worker.close();await worker.closed; }
}


/** Own-limit exhaustion is the case's outcome. An ancestor kill is pressure. */
export function commandMemoryFailure(result: Pick<ActiveResult, "memory">, label: string): CaseBudgetError | PressureError | undefined {
  if (!result.memory) return;
  if (result.memory.cause === "own-limit") return new CaseBudgetError(`${label} exceeded its ${result.memory.limitBytes} byte worker cap`);
  return new PressureError(`${label} was killed by ${result.memory.cause} outside its case cap`);
}
