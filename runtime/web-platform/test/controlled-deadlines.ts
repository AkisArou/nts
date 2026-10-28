import { VirtualScheduler } from "../src/provider/virtual-time.ts";
import type { CancelHandle, Scheduler } from "../src/provider/primitives.ts";

/** Real task/I/O progress, with deadlines advanced only by the test. */
export class ControlledDeadlines implements Scheduler {
  private readonly clock = new VirtualScheduler();
  private readonly timers: { milliseconds: number; active: boolean }[] = [];
  private readonly waiting = new Map<number, (() => void)[]>();
  private readonly tasks: Scheduler;

  constructor(tasks: Scheduler) { this.tasks = tasks; }

  enqueue(task: () => void): void { this.tasks.enqueue(task); }
  reportError(error: unknown): void { this.tasks.reportError(error); }

  delay(milliseconds: number, task: () => void): CancelHandle {
    const record = { milliseconds, active: true };
    const timer = this.clock.delay(milliseconds, () => {
      record.active = false;
      task();
    });
    this.timers.push(record);
    for (const resolve of this.waiting.get(milliseconds) ?? []) resolve();
    this.waiting.delete(milliseconds);
    return { cancel: () => { record.active = false; timer.cancel(); } };
  }

  scheduled(milliseconds: number): Promise<void> {
    if (this.timers.some((timer) => timer.active && timer.milliseconds === milliseconds)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const waiting = this.waiting.get(milliseconds) ?? [];
      waiting.push(resolve);
      this.waiting.set(milliseconds, waiting);
    });
  }

  advance(milliseconds: number): void { this.clock.advance(milliseconds); }
}
