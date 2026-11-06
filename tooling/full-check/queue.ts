// The landing queue the full check submits its reverts and records commits to:
// `submit(commit, { first })` from tooling/landing/, which the landing check
// owns. A revert goes in first, ahead of every other change; a records commit
// takes its turn. Until that module is on the tree, the service says it cannot
// submit, keeps the commit reachable and prints the command for it.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type SubmitOptions = { first?: boolean };
export type LandingQueue = { submit(commit: string, options?: SubmitOptions): unknown };

/** The landing check's queue module: the one place the two services meet. */
export const QUEUE_MODULE = new URL("../landing/queue.ts", import.meta.url);

/** The landing queue, or why there is none to submit to. */
export async function landingQueue(module: URL = QUEUE_MODULE): Promise<LandingQueue | { unavailable: string }> {
  const path = fileURLToPath(module);
  if (!existsSync(path)) return { unavailable: `no landing queue at ${path}` };
  const loaded = await import(module.href) as Partial<LandingQueue>;
  if (typeof loaded.submit !== "function") return { unavailable: `${path} exports no submit(commit, options)` };
  return { submit: loaded.submit };
}

/** Submit, and say what happened in one line; a failure is reported, not thrown. */
export async function submitTo(queue: LandingQueue | { unavailable: string }, commit: string, options: SubmitOptions): Promise<{ submitted: boolean; line: string }> {
  if ("unavailable" in queue) return { submitted: false, line: `not submitted (${queue.unavailable}): submit ${commit}${options.first ? " first" : ""} by hand` };
  try {
    await queue.submit(commit, options);
    return { submitted: true, line: `submitted ${commit}${options.first ? " first" : ""} to the landing queue` };
  } catch (error) {
    return { submitted: false, line: `the landing queue refused ${commit}: ${error instanceof Error ? error.message : String(error)}` };
  }
}
