// Test infrastructure only. Elapsed time can report a hung fixture; it cannot
// prove that a child started, completed, released a token, or produced output.
import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";
import { setTimeout as poll } from "node:timers/promises";

export const TEST_HANG_MS = 5 * 60_000;

export async function waitFor(
  what: string,
  ready: () => boolean,
  options: { timeoutMs?: number; stopped?: () => string | undefined } = {},
): Promise<void> {
  const limit = options.timeoutMs ?? TEST_HANG_MS;
  const started = performance.now();
  while (!ready()) {
    const stopped = options.stopped?.();
    if (stopped) throw new Error(`test fixture stopped while waiting for ${what}: ${stopped}`);
    if (performance.now() - started >= limit) throw new Error(`test hung waiting for ${what} (${limit} ms hang guard)`);
    await poll(10);
  }
}

/** Keep the command's own exit status. A test wrapper timeout is not its result. */
export function testProcessResult<T>(result: SpawnSyncReturns<T>, what: string): SpawnSyncReturns<T> {
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    throw new Error(`test hung waiting for ${what} (${TEST_HANG_MS} ms hang guard)\n${result.stdout ?? ""}${result.stderr ?? ""}`, { cause: result.error });
  }
  return result;
}

export function spawnTest(
  command: string,
  args: readonly string[],
  options: Omit<SpawnSyncOptionsWithStringEncoding, "timeout">,
  what = [command, ...args.slice(0, 2)].join(" "),
): SpawnSyncReturns<string> {
  return testProcessResult(spawnSync(command, args, { ...options, timeout: TEST_HANG_MS }), what);
}
