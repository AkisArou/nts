import type { CancelHandle, Scheduler } from "./primitives.ts";

interface VirtualTimer {
  readonly deadline: number;
  /** Insertion order, so equal deadlines have one defined outcome rather than a race. */
  readonly sequence: number;
  readonly task: () => void;
  cancelled: boolean;
}

export interface VirtualSchedulerOptions {
  /** Logical milliseconds at construction. */
  readonly startMilliseconds?: number;
  /**
   * Where task exceptions go. The default collects them in {@link VirtualScheduler.errors}
   * rather than throwing, so one failing task does not abandon a run mid-way and hide
   * every later assertion behind it.
   */
  readonly reportError?: (error: unknown) => void;
}

/**
 * A `Scheduler` whose clock only moves when it is told to.
 *
 * The integration contract requires deterministic oracle tests to use virtual time and
 * requires that network activity never silently advances it. Both follow from the same
 * property: nothing here observes a real clock, so time passes only through
 * {@link VirtualScheduler.advance}. A test that expects a timeout must say so.
 *
 * This is a provider, not a test helper, and it is portable: it has no host
 * dependency, so every target can run the same deterministic corpus.
 */
export class VirtualScheduler implements Scheduler {
  #now: number;
  #sequence = 0;
  #timers: VirtualTimer[] = [];
  #queue: (() => void)[] = [];
  #draining = false;
  readonly #report: ((error: unknown) => void) | undefined;
  /** Exceptions from tasks, in the order they were reported. */
  readonly errors: unknown[] = [];

  constructor(options: VirtualSchedulerOptions = {}) {
    const start = options.startMilliseconds ?? 0;
    if (!Number.isFinite(start) || start < 0) {
      throw new RangeError("Virtual time must start at a non-negative finite value");
    }
    this.#now = start;
    this.#report = options.reportError;
  }

  /** The current logical time. */
  get now(): number {
    return this.#now;
  }

  /** Whether anything is waiting: a queued task or an uncancelled timer. */
  get hasPending(): boolean {
    if (this.#queue.length !== 0) return true;
    for (const timer of this.#timers) if (!timer.cancelled) return true;
    return false;
  }

  /** The logical time of the earliest uncancelled timer, or null. */
  get nextDeadline(): number | null {
    let earliest: number | null = null;
    for (const timer of this.#timers) {
      if (timer.cancelled) continue;
      if (earliest === null || timer.deadline < earliest) earliest = timer.deadline;
    }
    return earliest;
  }

  enqueue(task: () => void): void {
    this.#queue.push(task);
  }

  delay(milliseconds: number, task: () => void): CancelHandle {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError("A delay must be a non-negative finite number of milliseconds");
    }
    const timer: VirtualTimer = {
      deadline: this.#now + milliseconds,
      sequence: this.#sequence++,
      task,
      cancelled: false,
    };
    this.#timers.push(timer);
    return {
      cancel: (): void => {
        // Cancelling is idempotent and takes effect even mid-advance, because a task
        // that runs may cancel a timer this advance has not reached yet.
        timer.cancelled = true;
      },
    };
  }

  reportError(error: unknown): void {
    if (this.#report !== undefined) {
      this.#report(error);
      return;
    }
    this.errors.push(error);
  }

  /** Runs queued tasks and any timer already due, without moving the clock. */
  runPending(): void {
    this.#runDue(this.#now);
  }

  /**
   * Moves the clock forward, running everything that becomes due on the way.
   *
   * The clock stops at each deadline rather than jumping to the end, so a task
   * scheduling another timer sees the time its own deadline implies and a timer it
   * schedules inside the remaining window still runs in this advance. Jumping would
   * make the result depend on how the caller chose to divide the interval.
   */
  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError("Advancing requires a non-negative finite number of milliseconds");
    }
    const target = this.#now + milliseconds;
    this.#runDue(target);
    this.#now = target;
    this.#runDue(target);
  }

  /**
   * Advances to the next deadline, or does nothing when none is pending.
   *
   * Returns whether it moved, so a caller can drive a scheduler to quiescence without
   * guessing an interval.
   */
  advanceToNextDeadline(): boolean {
    const next = this.nextDeadline;
    if (next === null) return false;
    this.advance(Math.max(0, next - this.#now));
    return true;
  }

  #runDue(limit: number): void {
    // A task may enqueue or schedule more work; re-entering would run it out of order,
    // so the outermost call owns the loop.
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (true) {
        if (this.#queue.length !== 0) {
          const queued = this.#queue;
          this.#queue = [];
          for (const task of queued) this.#run(task);
          continue;
        }
        const due = this.#takeEarliestDue(limit);
        if (due === null) return;
        this.#now = due.deadline;
        this.#run(due.task);
      }
    } finally {
      this.#draining = false;
    }
  }

  #takeEarliestDue(limit: number): VirtualTimer | null {
    let chosen: VirtualTimer | null = null;
    let chosenIndex = -1;
    for (let index = 0; index < this.#timers.length; index++) {
      const timer = this.#timers[index];
      if (timer === undefined || timer.cancelled || timer.deadline > limit) continue;
      if (
        chosen === null ||
        timer.deadline < chosen.deadline ||
        (timer.deadline === chosen.deadline && timer.sequence < chosen.sequence)
      ) {
        chosen = timer;
        chosenIndex = index;
      }
    }
    if (chosen === null) {
      this.#compact();
      return null;
    }
    this.#timers.splice(chosenIndex, 1);
    return chosen;
  }

  #compact(): void {
    let write = 0;
    for (let read = 0; read < this.#timers.length; read++) {
      const timer = this.#timers[read];
      if (timer !== undefined && !timer.cancelled) this.#timers[write++] = timer;
    }
    this.#timers.length = write;
  }

  #run(task: () => void): void {
    try {
      task();
    } catch (error) {
      this.reportError(error);
    }
  }
}
