import type { EventHandlerSlot } from "./events.ts";
import { Event, EventTarget } from "./events.ts";
import { abortError, DOMException } from "./errors.ts";
import type { Scheduler } from "./platform.ts";

interface Algorithm {
  callback: () => void;
  active: boolean;
}

export class AbortSignal extends EventTarget {
  private isAborted = false;
  private abortReason: unknown = undefined;
  private readonly algorithms: Algorithm[] = [];
  private readonly abortHandler: EventHandlerSlot<AbortSignal, Event> = {
    callback: null,
    listener: null,
  };

  get onabort(): ((this: AbortSignal, event: Event) => void) | null {
    return this.abortHandler.callback;
  }

  set onabort(callback: ((this: AbortSignal, event: Event) => void) | null) {
    this.setHandler(this, this.abortHandler, "abort", callback, (_event): _event is Event => true);
  }

  get aborted(): boolean {
    return this.isAborted;
  }

  get reason(): unknown {
    return this.abortReason;
  }

  throwIfAborted(): void {
    if (this.isAborted) throw this.abortReason;
  }
  /** Internal cancellation algorithms cannot be blocked by stopImmediatePropagation. */
  subscribe(callback: () => void): () => void {
    if (this.isAborted) {
      try {
        callback();
      } catch (error) {
        this.report(error);
      }
      return () => {};
    }
    const algorithm = { callback, active: true };
    this.algorithms.push(algorithm);
    return () => {
      algorithm.active = false;
      const index = this.algorithms.indexOf(algorithm);
      if (index >= 0) this.algorithms.splice(index, 1);
    };
  }
  /** @internal */ trigger(reason: unknown): void {
    if (this.isAborted) return;
    this.isAborted = true;
    this.abortReason = reason === undefined ? abortError() : reason;
    const pending = this.algorithms.splice(0);
    for (const algorithm of pending)
      if (algorithm.active) {
        try {
          algorithm.callback();
        } catch (error) {
          this.report(error);
        }
      }
    const event = new Event("abort");
    this.dispatchEvent(event);
  }
  static abort(reason?: unknown): AbortSignal {
    const signal = new AbortSignal();
    signal.trigger(reason);
    return signal;
  }
  static any(signals: readonly AbortSignal[]): AbortSignal {
    const result = new AbortSignal();
    for (const signal of signals) {
      if (signal.aborted) {
        result.trigger(signal.reason);
        return result;
      }
    }
    const cleanup: (() => void)[] = [];
    for (const signal of signals) {
      cleanup.push(
        signal.subscribe(() => {
          for (const dispose of cleanup) dispose();
          result.trigger(signal.reason);
        }),
      );
    }
    return result;
  }
  /** Runtime code supplies its owning environment's scheduler. */
  static timeout(milliseconds: number, scheduler: Scheduler): AbortSignal {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0)
      throw new RangeError("Invalid timeout");
    const signal = new AbortSignal((error) => scheduler.reportError(error));
    scheduler.delay(milliseconds, () =>
      signal.trigger(new DOMException("The operation timed out", "TimeoutError")),
    );
    return signal;
  }
}

export class AbortController {
  readonly signal: AbortSignal;

  constructor(report?: (error: unknown) => void) {
    this.signal = new AbortSignal(report);
  }

  abort(reason?: unknown): void {
    this.signal.trigger(reason);
  }
}
