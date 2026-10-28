import type { ErrorEvent, Event } from "../core/events.ts";

/** Implementation-defined error metadata, extracted without invoking script getters. */
export interface GlobalErrorInformation {
  readonly message: string;
  readonly filename: string;
  readonly lineno: number;
  readonly colno: number;
  /** Whether HTML's selected classic script has its muted-errors flag set. */
  readonly muted: boolean;
}

export type GlobalErrorEventType = "error" | "unhandledrejection" | "rejectionhandled";
export type GlobalErrorListener = (event: Event) => void;

/** A source-owned reporting destination, including one in a different realm. */
export interface GlobalExceptionReporter {
  reportException(exception: unknown, omitError?: boolean): void;
}

/**
 * Engine/provider boundaries for HTML's global error policy.
 *
 * These operations are infallible: native bindings must never throw into
 * TypeScript. A binding must not advertise this capability until it can supply
 * the actual global's event state, exception metadata, and Promise internal
 * slots. A detached EventTarget or a thenable inspection is not equivalent.
 * Source code owns event construction, cancellation policy and rejection lists.
 */
export interface GlobalErrorCapabilities {
  /** The actual global (or WindowProxy exposed as its this value). */
  readonly globalObject: object;

  /** Web IDL receiver resolution for reportError borrowed across globals. */
  resolveGlobalReporter(receiver: object): GlobalExceptionReporter | null;

  /** No Get, ToString, stack parsing, or other script-observable input access. */
  extractErrorInformation(exception: unknown): GlobalErrorInformation;

  /** Internal non-capture listener operations at the real global target. */
  addGlobalEventListener(type: GlobalErrorEventType, callback: GlobalErrorListener): void;
  removeGlobalEventListener(type: GlobalErrorEventType, callback: GlobalErrorListener): void;

  /**
   * Dispatch a trusted canonical Event at globalObject; return !canceled.
   * target/currentTarget and callback this must be the actual global. Enter its
   * realm for script callbacks and perform HTML callback cleanup. Apply the
   * platform's scripting-enabled and fully-active Document checks, when any.
   * Listener exceptions go to reportException and never escape dispatch.
   */
  dispatchGlobalEvent(event: Event, reportException: (exception: unknown) => void): boolean;

  /** Queue on this global's DOM manipulation task source, never inline. */
  enqueueGlobalTask(task: () => void): void;

  /** Read [[PromiseIsHandled]] and [[PromiseResult]], not public properties. */
  promiseIsHandled(promise: object): boolean;
  promiseResult(promise: object): unknown;

  /** Optional reporting chosen by the embedder; these must not throw. */
  reportExceptionToConsole(exception: unknown): void;
  reportRejectionToConsole(reason: unknown): void;

  /**
   * Optional dedicated-worker owner. A real worker provider supplies the parent
   * event/task boundary. Source policy below that boundary omits event.error.
   */
  readonly dedicatedWorkerOwner?: GlobalWorkerErrorOwner;
}

/** The worker owner crosses a realm boundary that source alone cannot enter. */
export interface GlobalWorkerErrorOwner extends GlobalExceptionReporter {
  enqueueGlobalTask(task: () => void): void;
  /**
   * Dispatch at the associated Worker object in its owner's realm; suppress
   * that worker's handlers when its connecting port is disentangled.
   */
  dispatchWorkerError(event: ErrorEvent, reportException: (exception: unknown) => void): boolean;
}
