// Test-only deterministic driver for the explicit global-error engine contract.
// It is not a native global/Promise adapter and must never enter src/ or host/.
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { GlobalErrorRuntime } from "../../src/core/global-errors.ts";
import { eventBegin, eventEnd, eventStopped } from "../../src/core/events.ts";
import type { Event, EventTarget } from "../../src/core/events.ts";
import type {
  GlobalErrorCapabilities, GlobalErrorEventType, GlobalErrorInformation,
  GlobalErrorListener, GlobalExceptionReporter, GlobalWorkerErrorOwner,
  GlobalHandlerArguments, GlobalHandlerCallback, GlobalHandlerInvocationResult,
} from "../../src/provider/global-errors.ts";

interface HandlerInvocation {
  readonly callback: GlobalHandlerCallback;
  readonly receiver: object;
  readonly args: GlobalHandlerArguments;
}

class Listener {
  readonly type: GlobalErrorEventType;
  readonly callback: GlobalErrorListener;
  removed = false;
  constructor(type: GlobalErrorEventType, callback: GlobalErrorListener) {
    this.type = type;
    this.callback = callback;
  }
}

class PromiseState {
  handled = false;
  readonly result: unknown;
  constructor(result: unknown) { this.result = result; }
}

export class ErrorDriver implements GlobalErrorCapabilities {
  readonly globalObject = globalThis;
  readonly listeners: Listener[] = [];
  readonly tasks: (() => void)[] = [];
  readonly events: Event[] = [];
  readonly errors: unknown[] = [];
  readonly rejections: unknown[] = [];
  readonly extractions: unknown[] = [];
  readonly reads: string[] = [];
  readonly invocations: HandlerInvocation[] = [];
  readonly inactiveHandlers = new WeakSet<GlobalHandlerCallback>();
  invocationCleanup: (() => void) | undefined = undefined;
  readonly globalDestinations = new WeakMap<object, GlobalExceptionReporter>();
  readonly promises = new WeakMap<object, PromiseState>();
  readonly runtime: GlobalErrorRuntime;
  dedicatedWorkerOwner: GlobalWorkerErrorOwner | undefined;
  information: GlobalErrorInformation = {
    message: "provider message", filename: "provider-source.ts", lineno: 23, colno: 7, muted: false,
  };

  constructor() { this.runtime = new GlobalErrorRuntime(this); }
  resolveGlobalReporter(receiver: object): GlobalExceptionReporter | null {
    return this.globalDestinations.get(receiver) ?? null;
  }
  extractErrorInformation(exception: unknown): GlobalErrorInformation {
    this.extractions.push(exception);
    return this.information;
  }
  addGlobalEventListener(type: GlobalErrorEventType, callback: GlobalErrorListener): void {
    this.listeners.push(new Listener(type, callback));
  }
  removeGlobalEventListener(type: GlobalErrorEventType, callback: GlobalErrorListener): void {
    for (const listener of this.listeners) {
      if (listener.type === type && listener.callback === callback) listener.removed = true;
    }
  }
  invokeGlobalHandler(
    callback: GlobalHandlerCallback, receiver: object, args: GlobalHandlerArguments,
  ): GlobalHandlerInvocationResult {
    this.invocations.push({ callback, receiver, args });
    if (this.inactiveHandlers.has(callback)) return { ok: true, value: undefined };
    let result: GlobalHandlerInvocationResult;
    try { result = { ok: true, value: Reflect.apply(callback, receiver, args) }; }
    catch (error) { result = { ok: false, error }; }
    // Deterministic test boundary only. A production provider supplies actual
    // realm preparation, callback cleanup and its engine's checkpoint behavior.
    this.invocationCleanup?.();
    return result;
  }
  dispatchGlobalEvent(event: Event, reportException: (exception: unknown) => void): boolean {
    this.events.push(event);
    // The internal Event hooks let this deterministic driver exercise actual
    // canonical event cancellation/trust. A production native global binding
    // still has to supply its complete listener semantics and callback cleanup.
    event[eventBegin](globalThis as unknown as EventTarget, true);
    try {
      for (const listener of this.listeners.slice()) {
        if (event[eventStopped]) break;
        if (listener.removed || listener.type !== event.type) continue;
        try { listener.callback(event); }
        catch (error) { reportException(error); }
      }
    } finally { event[eventEnd](); }
    return !event.defaultPrevented;
  }
  enqueueGlobalTask(task: () => void): void { this.tasks.push(task); }
  promiseIsHandled(promise: object): boolean {
    const state = this.promises.get(promise);
    assert.ok(state, "test promise must have actual driver state");
    return state.handled;
  }
  promiseResult(promise: object): unknown {
    const state = this.promises.get(promise);
    assert.ok(state, "test promise must have actual driver state");
    return state.result;
  }
  reportExceptionToConsole(exception: unknown): void { this.errors.push(exception); }
  reportRejectionToConsole(reason: unknown): void { this.rejections.push(reason); }

  report(exception: unknown): void { this.runtime.reportError.call(globalThis, exception); }
  promise(reason: unknown, value: object = {}): object {
    this.promises.set(value, new PromiseState(reason));
    return value;
  }
  handle(promise: object): void {
    const state = this.promises.get(promise);
    assert.ok(state);
    state.handled = true;
    this.runtime.hostPromiseRejectionTracker(promise, "handle");
  }
  task(): void {
    const task = this.tasks.shift();
    assert.ok(task, "expected a queued global task");
    task();
  }
}

export function driver(t: TestContext): ErrorDriver {
  const driver = new ErrorDriver();
  // Test-only bootstrap of this process's actual globals. Production source
  // contains no Object.defineProperty or globalThis writes. Every descriptor is
  // restored, so the module never leaves handlers in Node's own environment.
  for (const name of ["onerror", "onunhandledrejection", "onrejectionhandled"] as const) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() { driver.reads.push(name); return driver.runtime[name]; },
      set(value: object | null) { driver.runtime[name] = value; },
    });
    t.after(() => {
      if (old === undefined) delete (globalThis as Record<string, unknown>)[name];
      else Object.defineProperty(globalThis, name, old);
    });
  }
  return driver;
}
