// A gate run's step lifecycle, as its runner (run.mjs) publishes it in the run
// folder: how many step events it has had, a start or a finish, and which
// steps run now. The full check's run bound reads it from outside the run
// (full-check/measure-command.ts, step-bound.ts's ProgressBound): time with no
// step running and no step event, outside the run's own waits, is bounded, so
// work no step bounds cannot spin unseen. A runner that does not have this
// module publishes nothing, and its run has no such bound.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RUN_LIFECYCLE = "run-lifecycle.json";

export type RunLifecycle = { version: 1; events: number; running: string[] };

/** The run's lifecycle, or null when its runner has published none or it is not one. */
export function readRunLifecycle(run: string): RunLifecycle | null {
  let value: RunLifecycle;
  try { value = JSON.parse(readFileSync(join(run, RUN_LIFECYCLE), "utf8")) as RunLifecycle; }
  catch { return null; }
  return value?.version === 1 && Number.isSafeInteger(value.events) && value.events >= 0
    && Array.isArray(value.running) && value.running.every(step => typeof step === "string") ? value : null;
}

/** The runner's side: each step start and finish, published whole. */
export class RunLifecycleFeed {
  readonly #file: string;
  #events = 0;
  readonly #running = new Set<string>();

  constructor(run: string) { this.#file = join(run, RUN_LIFECYCLE); this.#publish(); }

  started(step: string): void { this.#running.add(step); this.#events++; this.#publish(); }
  finished(step: string): void { if (this.#running.delete(step)) { this.#events++; this.#publish(); } }

  #publish(): void {
    const value: RunLifecycle = { version: 1, events: this.#events, running: [...this.#running].sort() };
    writeFileSync(`${this.#file}.next`, JSON.stringify(value) + "\n");
    renameSync(`${this.#file}.next`, this.#file);
  }
}
