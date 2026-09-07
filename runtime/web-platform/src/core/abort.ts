import { abortSignalBrand } from "./abort-brand.ts";
import type { AbortSignalOperations } from "./abort-brand.ts";
import type { EventHandlerSlot } from "./events.ts";
import { Event, EventTarget } from "./events.ts";
import { abortError, DOMException } from "./errors.ts";
import { currentWebPlatformRuntime } from "../provider/environment.ts";
import { requireArguments, toEnforceRangeUnsignedLongLong } from "./webidl.ts";

interface AbortAlgorithm {
  callback: () => void;
  active: boolean;
  previous: AbortAlgorithm | null;
  next: AbortAlgorithm | null;
}

function doNothing(): void {}

const abortSignalConstructorKey: unique symbol = Symbol("construct NTS AbortSignal");

export class AbortSignal extends EventTarget implements AbortSignalOperations {
  readonly [abortSignalBrand] = true;
  private isAborted = false;
  private abortReason: unknown = undefined;
  private firstAlgorithm: AbortAlgorithm | null = null;
  private lastAlgorithm: AbortAlgorithm | null = null;
  private runningAlgorithms = false;
  private readonly sourceSignals: WeakRef<AbortSignal>[] = [];
  private readonly dependentSignals: WeakRef<AbortSignal>[] = [];
  private readonly retainedDependents: AbortSignal[] = [];
  private selfReference: WeakRef<AbortSignal> | null = null;
  private dependentCleanup: FinalizationRegistry<WeakRef<AbortSignal>> | null = null;
  private abortListenerCount = 0;
  private abortAlgorithmCount = 0;
  private retainedBySources = false;
  private readonly abortHandler: EventHandlerSlot<AbortSignal, Event> = {
    callback: null,
    listener: null,
  };

  constructor(key: typeof abortSignalConstructorKey, errorReporter?: (error: unknown) => void) {
    if (key !== abortSignalConstructorKey) {
      throw new TypeError("Illegal constructor");
    }
    super();
    if (errorReporter !== undefined) {
      this.setErrorReporter(errorReporter);
    }
  }

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
        this.reportError(error);
      }
      return doNothing;
    }
    const algorithm: AbortAlgorithm = {
      callback,
      active: true,
      previous: this.lastAlgorithm,
      next: null,
    };
    if (this.lastAlgorithm === null) this.firstAlgorithm = algorithm;
    else this.lastAlgorithm.next = algorithm;
    this.lastAlgorithm = algorithm;
    this.abortAlgorithmCount++;
    this.#updateSourceRetention();
    return () => this.#removeAlgorithm(algorithm);
  }

  /** @internal */ trigger(reason: unknown): void {
    if (!this.#markAborted(reason)) return;

    const dependents = this.#markDependentsAborted();
    this.#detachFromSources();
    for (const dependent of dependents) dependent.#detachFromSources();

    this.#runAbortSteps();
    for (const dependent of dependents) dependent.#runAbortSteps();
  }

  static abort(reason?: unknown): AbortSignal {
    const signal = new AbortSignal(abortSignalConstructorKey);
    signal.trigger(reason);
    return signal;
  }

  static any(signals: Iterable<AbortSignal>): AbortSignal {
    const converted: AbortSignal[] = [];
    for (const signal of signals) {
      if (!(signal instanceof AbortSignal))
        throw new TypeError("signals must contain AbortSignal values");
      converted.push(signal);
    }

    const result = new AbortSignal(abortSignalConstructorKey);
    for (const signal of converted) {
      if (signal.aborted) {
        result.trigger(signal.reason);
        return result;
      }
    }

    for (const signal of converted) {
      if (signal.sourceSignals.length === 0) result.#addSourceSignal(signal);
      else {
        for (const sourceReference of signal.sourceSignals) {
          const source = sourceReference.deref();
          if (source !== undefined) result.#addSourceSignal(source);
        }
      }
    }
    result.setListenerObserver((type, added) => result.#observeListener(type, added));
    return result;
  }

  static timeout(milliseconds: number): AbortSignal {
    requireArguments(arguments, 1, "AbortSignal.timeout");
    const delay = toEnforceRangeUnsignedLongLong(milliseconds);
    const scheduler = currentWebPlatformRuntime().scheduler;
    const signal = new AbortSignal(abortSignalConstructorKey, (error) =>
      scheduler.reportError(error),
    );
    scheduler.delay(delay, () =>
      signal.trigger(new DOMException("The operation timed out", "TimeoutError")),
    );
    return signal;
  }

  #markAborted(reason: unknown): boolean {
    if (this.isAborted) return false;
    this.isAborted = true;
    this.abortReason = reason === undefined ? abortError() : reason;
    return true;
  }

  #markDependentsAborted(): AbortSignal[] {
    const pending: AbortSignal[] = [];
    const cleanup = this.dependentCleanup;
    for (const reference of this.dependentSignals) {
      cleanup?.unregister(reference);
      const dependent = reference.deref();
      if (dependent !== undefined && dependent.#markAborted(this.abortReason))
        pending.push(dependent);
    }
    this.dependentSignals.length = 0;
    this.retainedDependents.length = 0;
    return pending;
  }

  #runAbortSteps(): void {
    let algorithm = this.firstAlgorithm;
    this.firstAlgorithm = null;
    this.lastAlgorithm = null;
    this.runningAlgorithms = true;
    try {
      while (algorithm !== null) {
        const next = algorithm.next;
        if (algorithm.active) {
          algorithm.active = false;
          this.abortAlgorithmCount--;
          try {
            algorithm.callback();
          } catch (error) {
            this.reportError(error);
          }
        }
        algorithm.previous = null;
        algorithm.next = null;
        algorithm = next;
      }
    } finally {
      this.runningAlgorithms = false;
      this.abortAlgorithmCount = 0;
      this.#updateSourceRetention();
    }
    this.dispatchTrustedEvent(new Event("abort"));
  }

  #removeAlgorithm(algorithm: AbortAlgorithm): void {
    if (!algorithm.active) return;
    algorithm.active = false;
    this.abortAlgorithmCount--;
    this.#updateSourceRetention();
    if (this.runningAlgorithms) return;

    const previous = algorithm.previous;
    const next = algorithm.next;
    if (previous === null) this.firstAlgorithm = next;
    else previous.next = next;
    if (next === null) this.lastAlgorithm = previous;
    else next.previous = previous;
    algorithm.previous = null;
    algorithm.next = null;
  }

  #addSourceSignal(source: AbortSignal): void {
    for (const reference of this.sourceSignals) if (reference.deref() === source) return;

    const sourceReference = source.#reference();
    this.sourceSignals.push(sourceReference);
    source.#addDependentSignal(this, this.#reference());
  }

  #addDependentSignal(
    dependent: AbortSignal,
    dependentReference: WeakRef<AbortSignal>,
  ): void {
    this.dependentSignals.push(dependentReference);
    if (this.dependentCleanup === null) {
      const sourceReference = this.#reference();
      this.dependentCleanup = new FinalizationRegistry((reference) => {
        // Written out rather than optionally chained: an optional chain cannot carry a
        // private identifier, and the receiver is another instance of this class.
        const source = sourceReference.deref();
        if (source !== undefined) source.#removeDependentSignal(reference);
      });
    }
    this.dependentCleanup.register(dependent, dependentReference, dependentReference);
  }

  #removeDependentSignal(reference: WeakRef<AbortSignal>): void {
    this.dependentCleanup?.unregister(reference);
    const index = this.dependentSignals.indexOf(reference);
    if (index < 0) return;
    for (let read = index + 1; read < this.dependentSignals.length; read++) {
      const current = this.dependentSignals[read];
      if (current !== undefined) this.dependentSignals[read - 1] = current;
    }
    this.dependentSignals.length--;
  }

  #retainDependentSignal(dependent: AbortSignal): void {
    if (!this.retainedDependents.includes(dependent)) this.retainedDependents.push(dependent);
  }

  #releaseDependentSignal(dependent: AbortSignal): void {
    const index = this.retainedDependents.indexOf(dependent);
    if (index < 0) return;
    for (let read = index + 1; read < this.retainedDependents.length; read++) {
      const current = this.retainedDependents[read];
      if (current !== undefined) this.retainedDependents[read - 1] = current;
    }
    this.retainedDependents.length--;
  }

  #detachFromSources(): void {
    if (this.selfReference !== null) {
      for (const reference of this.sourceSignals) {
        const source = reference.deref();
        if (source !== undefined) source.#removeDependentSignal(this.selfReference);
      }
    }
    this.sourceSignals.length = 0;
    this.retainedBySources = false;
  }

  #reference(): WeakRef<AbortSignal> {
    if (this.selfReference === null) this.selfReference = new WeakRef(this);
    return this.selfReference;
  }

  #observeListener(type: string, added: boolean): void {
    if (type !== "abort") return;
    if (added) this.abortListenerCount++;
    else this.abortListenerCount--;
    this.#updateSourceRetention();
  }

  #updateSourceRetention(): void {
    const shouldRetain = !this.isAborted && this.abortListenerCount + this.abortAlgorithmCount > 0;
    if (shouldRetain === this.retainedBySources) return;

    this.retainedBySources = shouldRetain;
    for (const reference of this.sourceSignals) {
      const source = reference.deref();
      if (source === undefined) continue;
      if (shouldRetain) source.#retainDependentSignal(this);
      else source.#releaseDependentSignal(this);
    }
  }

  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "AbortSignal",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

export class AbortController {
  private readonly controllerSignal = createAbortSignal();

  get signal(): AbortSignal {
    return this.controllerSignal;
  }

  abort(reason?: unknown): void {
    this.controllerSignal.trigger(reason);
  }

  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "AbortController",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

/** @internal Creates an un-aborted signal without exposing its illegal constructor. */
export function createAbortSignal(): AbortSignal {
  return new AbortSignal(abortSignalConstructorKey);
}
