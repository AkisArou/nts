import { ErrorEvent, Event } from "./events.ts";
import { PromiseRejectionEvent } from "./promise-rejection-event.ts";
import { requireArguments } from "./webidl.ts";
import type {
  GlobalErrorCapabilities, GlobalErrorEventType, GlobalErrorListener,
  GlobalExceptionReporter, GlobalHandlerArguments, GlobalHandlerCallback,
} from "../provider/global-errors.ts";

export type GlobalErrorHandler = (
  this: object, eventOrMessage: Event | string, filename?: string,
  lineno?: number, colno?: number, error?: unknown,
) => unknown;
export type GlobalRejectionHandler = (this: object, event: Event) => unknown;
export type GlobalErrorHandlerValue = GlobalErrorHandler | object | null;
export type GlobalRejectionHandlerValue = GlobalRejectionHandler | object | null;

interface GlobalErrorHandlerProperties {
  readonly onerror?: unknown;
  readonly onunhandledrejection?: unknown;
  readonly onrejectionhandled?: unknown;
}

class HandlerSlot {
  value: object | null = null;
  active = false;
}

const cancelEvent: (event: Event) => void = Function.prototype.call.bind(Event.prototype.preventDefault);

function objectValue(value: unknown): object | null {
  return value !== null && (typeof value === "object" || typeof value === "function") ? value : null;
}

/**
 * HTML global error/rejection policy, owned by one provider global.
 *
 * Bootstrap exposes the callable and the three plain accessors; this class
 * never writes globalThis. Its accessors are the backing slots, so a provider
 * getter must return runtime.onerror (etc.), not read globalThis again.
 */
export class GlobalErrorRuntime implements GlobalExceptionReporter {
  readonly #capabilities: GlobalErrorCapabilities;
  readonly #errorHandler = new HandlerSlot();
  readonly #unhandledHandler = new HandlerSlot();
  readonly #handledHandler = new HandlerSlot();
  readonly #onError: GlobalErrorListener;
  readonly #onUnhandled: GlobalErrorListener;
  readonly #onHandled: GlobalErrorListener;
  readonly #reportListenerException: (exception: unknown) => void;
  #inErrorReportingMode = false;
  #aboutToBeNotified: object[] = [];
  readonly #outstanding = new WeakSet<object>();
  readonly reportError: (this: unknown, exception: unknown) => void;

  constructor(capabilities: GlobalErrorCapabilities) {
    this.#capabilities = capabilities;
    this.#onError = (event): void => this.#processHandler("error", event);
    this.#onUnhandled = (event): void => this.#processHandler("unhandledrejection", event);
    this.#onHandled = (event): void => this.#processHandler("rejectionhandled", event);
    this.#reportListenerException = (exception): void => this.reportException(exception);
    const runtime = this;
    // Keep one required argument and Web IDL's ordinary global receiver rule.
    // A borrowed method resolves its actual destination through the provider.
    this.reportError = function reportError(this: unknown, exception: unknown): void {
      requireArguments(arguments, 1, "reportError");
      const receiver = this === undefined || this === null ? capabilities.globalObject : objectValue(this);
      if (receiver === null) throw new TypeError("reportError requires a global receiver");
      const destination = receiver === capabilities.globalObject
        ? runtime : capabilities.resolveGlobalReporter(receiver);
      if (destination === null) throw new TypeError("reportError requires a global receiver");
      destination.reportException(exception);
    };
  }

  get onerror(): GlobalErrorHandlerValue { return this.#errorHandler.value; }
  set onerror(value: GlobalErrorHandlerValue) {
    this.#setHandler(this.#errorHandler, "error", value, this.#onError);
  }

  get onunhandledrejection(): GlobalRejectionHandlerValue { return this.#unhandledHandler.value; }
  set onunhandledrejection(value: GlobalRejectionHandlerValue) {
    this.#setHandler(this.#unhandledHandler, "unhandledrejection", value, this.#onUnhandled);
  }

  get onrejectionhandled(): GlobalRejectionHandlerValue { return this.#handledHandler.value; }
  set onrejectionhandled(value: GlobalRejectionHandlerValue) {
    this.#setHandler(this.#handledHandler, "rejectionhandled", value, this.#onHandled);
  }

  #setHandler(slot: HandlerSlot, type: GlobalErrorEventType, value: unknown, listener: GlobalErrorListener): void {
    slot.value = objectValue(value);
    if (slot.value === null) {
      if (slot.active) this.#capabilities.removeGlobalEventListener(type, listener);
      slot.active = false;
    } else if (!slot.active) {
      this.#capabilities.addGlobalEventListener(type, listener);
      slot.active = true;
    }
  }

  #processHandler(type: GlobalErrorEventType, event: Event): void {
    // Bootstrap runs this callback in the global's realm. Read the current IDL
    // attribute exactly once: replacing a handler keeps its listener position.
    const scope = globalThis as GlobalErrorHandlerProperties;
    const callback = type === "error" ? scope.onerror : type === "unhandledrejection"
      ? scope.onunhandledrejection : scope.onrejectionhandled;
    if (typeof callback !== "function") return;
    const special = event instanceof ErrorEvent && event.type === "error";
    const args: GlobalHandlerArguments = special
      ? [event.message, event.filename, event.lineno, event.colno, event.error]
      : [event];
    // Web IDL invocation finishes callback/script cleanup before HTML processes
    // the return value. Dispatch cannot defer this to after our wrapper returns.
    const result = this.#capabilities.invokeGlobalHandler(callback as GlobalHandlerCallback, globalThis, args);
    if (!result.ok) throw result.error;
    if (special ? result.value === true : result.value === false) cancelEvent(event);
  }

  /** HTML 8.1.4.6: report an exception; listener errors re-enter this algorithm. */
  reportException(exception: unknown, omitError = false): void {
    const information = this.#capabilities.extractErrorInformation(exception);
    const muted = information.muted;
    const message = muted ? "Script error." : information.message;
    const filename = muted ? "" : information.filename;
    const lineno = muted ? 0 : information.lineno;
    const colno = muted ? 0 : information.colno;
    let notHandled = true;
    if (!this.#inErrorReportingMode) {
      this.#inErrorReportingMode = true;
      try {
        const event = new ErrorEvent("error", {
          cancelable: true, message, filename, lineno, colno,
          error: muted || omitError ? null : exception,
        });
        notHandled = this.#capabilities.dispatchGlobalEvent(event, this.#reportListenerException);
      } finally {
        this.#inErrorReportingMode = false;
      }
    }
    if (notHandled) {
      const owner = this.#capabilities.dedicatedWorkerOwner;
      if (owner === undefined) this.#capabilities.reportExceptionToConsole(exception);
      else owner.enqueueGlobalTask(() => {
        const event = new ErrorEvent("error", {
          cancelable: true, message, filename, lineno, colno, error: null,
        });
        if (owner.dispatchWorkerError(event, (error) => owner.reportException(error))) {
          owner.reportException(exception, true);
        }
      });
    }
  }

  /**
   * HTML 8.1.6.4. Called by the compiler's HostPromiseRejectionTracker for the
   * appropriate script/settings global, never by observing public .then.
   */
  hostPromiseRejectionTracker(promise: object, operation: "reject" | "handle", mutedErrors = false): void {
    if (mutedErrors) return;
    if (operation === "reject") {
      this.#aboutToBeNotified.push(promise);
      return;
    }
    const pendingIndex = this.#aboutToBeNotified.indexOf(promise);
    if (pendingIndex !== -1) {
      this.#aboutToBeNotified.splice(pendingIndex, 1);
      return;
    }
    if (!this.#outstanding.delete(promise)) return;
    this.#capabilities.enqueueGlobalTask(() => {
      const event = new PromiseRejectionEvent("rejectionhandled", {
        promise, reason: this.#capabilities.promiseResult(promise),
      });
      this.#capabilities.dispatchGlobalEvent(event, this.#reportListenerException);
    });
  }

  /** HTML 8.1.4.7; called after the actual microtask checkpoint by the engine. */
  notifyRejectedPromises(): void {
    const list = this.#aboutToBeNotified;
    if (list.length === 0) return;
    this.#aboutToBeNotified = [];
    this.#capabilities.enqueueGlobalTask(() => {
      for (const promise of list) {
        if (this.#capabilities.promiseIsHandled(promise)) continue;
        const reason = this.#capabilities.promiseResult(promise);
        const event = new PromiseRejectionEvent("unhandledrejection", {
          cancelable: true, promise, reason,
        });
        if (this.#capabilities.dispatchGlobalEvent(event, this.#reportListenerException)) {
          this.#capabilities.reportRejectionToConsole(reason);
        }
        if (!this.#capabilities.promiseIsHandled(promise)) this.#outstanding.add(promise);
      }
    });
  }
}
