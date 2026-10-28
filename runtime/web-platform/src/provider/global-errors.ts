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

/** Canonical ErrorEvent data, independent of overridable public accessors. */
export interface GlobalErrorEventData {
  readonly message: string;
  readonly filename: string;
  readonly lineno: number;
  readonly colno: number;
  readonly error: unknown;
}

export type GlobalErrorEventType = "error" | "unhandledrejection" | "rejectionhandled";
export type GlobalErrorListener = (event: Event) => void;

/** HTML's two argument lists for a global's event-handler IDL attributes. */
export type GlobalHandlerArguments =
  | [event: Event]
  | [message: string, filename: string, lineno: number, colno: number, error: unknown];
export type GlobalHandlerCallback = (this: object, ...args: GlobalHandlerArguments) => unknown;

/** Opaque provider-owned callback context; source retains it without inspection. */
export type GlobalHandlerContext = object;

/** Web IDL's callback completion crosses the native binding as a value. */
export type GlobalHandlerInvocationResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown };

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

  /**
   * Read the canonical ErrorEvent fields initialized by its constructor. This
   * infallible intrinsic must not dispatch subclass getters, inspect public
   * properties, or coerce values. The compiler/provider owns these layouts.
   */
  readErrorEventData(event: ErrorEvent): GlobalErrorEventData;

  /**
   * Internal non-capture listener operations at the real global target.
   * Route by the event's internal type, never an overridable `type` getter.
   */
  addGlobalEventListener(type: GlobalErrorEventType, callback: GlobalErrorListener): void;
  removeGlobalEventListener(type: GlobalErrorEventType, callback: GlobalErrorListener): void;

  /**
   * Capture the assigning script's incumbent settings during Web IDL callback
   * conversion. This infallible operation runs for every object assignment,
   * even when the same callback is assigned again. The token must retain that
   * conversion-time context, not derive it later from the callback's realm or
   * the invocation context. Internal source frames are implementation steps,
   * not a replacement for the assigning script's incumbent settings.
   */
  captureGlobalHandlerContext(): GlobalHandlerContext;

  /**
   * Invoke the actual IDL handler, not the source's internal listener wrapper.
   * Apply HTML's scripting-enabled and callback-realm fully-active checks; an
   * inactive handler returns { ok: true, value: undefined } without invocation.
   * Use Web IDL callback preparation, the callback's relevant settings and the
   * supplied assignment-time context as its stored settings,
   * and cleanup after running callback/script before returning its completion.
   * Cleanup includes a microtask checkpoint when HTML requires one. A thrown
   * callback value is returned as { ok: false, error }, never thrown by native
   * code. Source rethrows it and applies cancellation only to a normal result.
   */
  invokeGlobalHandler(
    callback: GlobalHandlerCallback, receiver: object, args: GlobalHandlerArguments,
    context: GlobalHandlerContext,
  ): GlobalHandlerInvocationResult;

  /**
   * Dispatch a trusted canonical Event at globalObject; return !canceled.
   * Route listeners by the event's internal type, not its public properties.
   * target/currentTarget and callback this must be the actual global. Enter its
   * realm for source listener wrappers. Ordinary script listeners use Web IDL
   * callback setup/cleanup; the internal handler wrappers call the separate
   * invokeGlobalHandler boundary before applying HTML's cancellation policy.
   * Cleaning up only after such a wrapper returns is too late. Apply the
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
