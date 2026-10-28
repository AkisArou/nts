// HTML source-policy controls over the deterministic engine contract driver.
import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { ErrorEvent, Event } from "../src/core/events.ts";
import { PromiseRejectionEvent } from "../src/core/promise-rejection-event.ts";
import { driver } from "./support/global-errors-driver.ts";

test("reportError has one required argument and validates a global receiver", (t) => {
  const d = driver(t);
  const report = d.runtime.reportError;
  assert.equal(report.name, "reportError");
  assert.equal(report.length, 1);
  assert.throws(() => (report as () => void)(), TypeError);
  assert.throws(() => report.call({}, "bad receiver"), TypeError);
  assert.throws(() => report.call(1, "bad receiver"), TypeError);
  assert.deepEqual(d.extractions, []);
  report(undefined);
  report.call(null, null);
  assert.deepEqual(d.errors, [undefined, null]);
});

test("reportError resolves a borrowed method's destination through its global capability", (t) => {
  const d = driver(t);
  const target = {};
  const seen: unknown[] = [];
  d.globalDestinations.set(target, { reportException: (error) => { seen.push(error); } });
  const reason = {};
  d.runtime.reportError.call(target, reason);
  assert.deepEqual(seen, [reason]);
  assert.equal(d.events.length, 0);
});

test("reportError dispatches synchronously with canonical metadata, identity and flags", (t) => {
  const d = driver(t);
  const reason = Symbol("original");
  let observed = false;
  d.addGlobalEventListener("error", (event) => {
    assert.ok(event instanceof ErrorEvent);
    assert.equal(event.target, globalThis);
    assert.equal(event.currentTarget, globalThis);
    assert.equal(event.eventPhase, Event.AT_TARGET);
    assert.equal(event.isTrusted, true);
    assert.equal(event.bubbles, false);
    assert.equal(event.composed, false);
    assert.equal(event.cancelable, true);
    assert.equal(event.error, reason);
    assert.deepEqual([event.message, event.filename, event.lineno, event.colno],
      ["provider message", "provider-source.ts", 23, 7]);
    observed = true;
  });
  d.report(reason);
  assert.ok(observed);
  assert.equal(d.events[0]?.currentTarget, null);
  assert.deepEqual(d.errors, [reason]);
});

test("source reporting never derives metadata through exception getters or coercion", (t) => {
  const d = driver(t);
  const reason = {
    get name(): never { throw new Error("name was read"); },
    get message(): never { throw new Error("message was read"); },
    get stack(): never { throw new Error("stack was read"); },
    get fileName(): never { throw new Error("fileName was read"); },
    get lineNumber(): never { throw new Error("lineNumber was read"); },
    [Symbol.toPrimitive](): never { throw new Error("coercion was invoked"); },
  };
  d.report(reason);
  assert.equal(d.extractions[0], reason);
  assert.equal(d.errors[0], reason);
});

for (const returned of [true, false, 1, "true", undefined]) {
  test(`onerror receives five arguments and only boolean true cancels (${String(returned)})`, (t) => {
    const d = driver(t);
    const reason = {};
    let count = 0;
    d.runtime.onerror = function (...args: unknown[]) {
      assert.equal(this, globalThis);
      assert.deepEqual(args, ["provider message", "provider-source.ts", 23, 7, reason]);
      count++;
      return returned;
    };
    d.report(reason);
    assert.equal(count, 1);
    assert.deepEqual(d.reads, ["onerror"]);
    assert.equal(d.events[0]?.defaultPrevented, returned === true);
    assert.equal(d.errors.length, returned === true ? 0 : 1);
  });
}

test("an ordinary error Event receives one argument and false cancels normally", (t) => {
  const d = driver(t);
  const event = new Event("error", { cancelable: true });
  d.runtime.onerror = function (...args: unknown[]) {
    assert.equal(this, globalThis);
    assert.deepEqual(args, [event]);
    return false;
  };
  assert.equal(d.dispatchGlobalEvent(event, (error) => d.runtime.reportException(error)), false);
  assert.equal(event.defaultPrevented, true);
});

test("global handler intrinsic data selects error handling independently of a subclass type getter", (t) => {
  const d = driver(t);
  let typeReads = 0;
  class CustomErrorEvent extends ErrorEvent {
    override get type(): string { typeReads++; return "other"; }
  }
  const reason = {};
  const event = new CustomErrorEvent("error", {
    cancelable: true, message: "original message", filename: "original.ts", lineno: 12, colno: 4, error: reason,
  });
  let received: unknown[] = [];
  d.runtime.onerror = function (...args: unknown[]) { received = args; return true; };
  assert.equal(d.dispatchGlobalEvent(event, (error) => d.runtime.reportException(error)), false);
  assert.deepEqual(received, ["original message", "original.ts", 12, 4, reason]);
  assert.equal(typeReads, 0);
  assert.deepEqual(d.errorEventReads, [event]);
  assert.deepEqual(d.errors, []);
});

test("global handler intrinsic data reads initialized ErrorEvent fields without invoking subclass getters", (t) => {
  const d = driver(t);
  const reads: string[] = [];
  class CustomErrorEvent extends ErrorEvent {
    override get message(): never { reads.push("message"); throw new Error("message getter"); }
    override get filename(): never { reads.push("filename"); throw new Error("filename getter"); }
    override get lineno(): never { reads.push("lineno"); throw new Error("lineno getter"); }
    override get colno(): never { reads.push("colno"); throw new Error("colno getter"); }
    override get error(): never { reads.push("error"); throw new Error("error getter"); }
  }
  const reason = Symbol("original error");
  const event = new CustomErrorEvent("error", {
    cancelable: true, message: "original message", filename: "original.ts", lineno: 12, colno: 4, error: reason,
  });
  let received: unknown[] = [];
  d.runtime.onerror = function (...args: unknown[]) { received = args; return true; };
  assert.equal(d.dispatchGlobalEvent(event, (error) => d.runtime.reportException(error)), false);
  assert.deepEqual(received, ["original message", "original.ts", 12, 4, reason]);
  assert.deepEqual(reads, []);
  assert.deepEqual(d.errorEventReads, [event]);
  assert.deepEqual(d.errors, []);
});

test("global handler intrinsic data does not treat a subclass error type getter as an internal error event", (t) => {
  const d = driver(t);
  let typeReads = 0;
  class CustomErrorEvent extends ErrorEvent {
    override get type(): string { typeReads++; return "error"; }
    override get message(): never { throw new Error("ordinary event message getter"); }
  }
  const event = new CustomErrorEvent("unhandledrejection", { cancelable: true });
  let received: unknown[] = [];
  d.runtime.onunhandledrejection = function (...args: unknown[]) { received = args; return false; };
  assert.equal(d.dispatchGlobalEvent(event, (error) => d.runtime.reportException(error)), false);
  assert.deepEqual(received, [event]);
  assert.equal(typeReads, 0);
  assert.deepEqual(d.errorEventReads, []);
  assert.deepEqual(d.errors, []);
});

test("global handler invocation cleanup precedes onerror cancellation", (t) => {
  const d = driver(t);
  const reason = {};
  const order: string[] = [];
  const cancellationAtCleanup: boolean[] = [];
  const handler = () => { order.push("handler"); return true; };
  d.runtime.onerror = handler;
  d.invocationCleanup = () => {
    order.push("cleanup");
    cancellationAtCleanup.push(d.events[0]!.defaultPrevented);
  };
  d.addGlobalEventListener("error", () => { order.push("following listener"); });
  d.report(reason);
  assert.deepEqual(order, ["handler", "cleanup", "following listener"]);
  assert.deepEqual(cancellationAtCleanup, [false]);
  assert.equal(d.events[0]?.defaultPrevented, true);
  assert.equal(d.invocations[0]?.callback, handler);
  assert.equal(d.invocations[0]?.receiver, globalThis);
  assert.deepEqual(d.invocations[0]?.args, ["provider message", "provider-source.ts", 23, 7, reason]);
  assert.deepEqual(d.errors, []);
});

test("global handler invocation cleanup can handle a rejection before cancellation and outstanding tracking", (t) => {
  const d = driver(t);
  const promise = d.promise("handled during cleanup");
  const cancellationAtCleanup: boolean[] = [];
  const handler = () => false;
  d.runtime.onunhandledrejection = handler;
  d.invocationCleanup = () => {
    cancellationAtCleanup.push(d.events[0]!.defaultPrevented);
    // Models a queued microtask running at the provider's actual callback
    // cleanup point. It is not a substitute for a native microtask checkpoint.
    d.handle(promise);
  };
  d.runtime.hostPromiseRejectionTracker(promise, "reject");
  d.runtime.notifyRejectedPromises();
  d.task();
  assert.deepEqual(cancellationAtCleanup, [false]);
  assert.equal(d.events[0]?.defaultPrevented, true);
  assert.equal(d.invocations[0]?.callback, handler);
  assert.deepEqual(d.invocations[0]?.args, [d.events[0]]);
  assert.deepEqual(d.rejections, []);
  d.handle(promise);
  assert.equal(d.tasks.length, 0, "cleanup handling prevents outstanding registration");
  assert.deepEqual(d.events.map((event) => event.type), ["unhandledrejection"]);
});

test("global handler invocation returns thrown values only after cleanup", (t) => {
  const d = driver(t);
  const inner = {};
  const outer = {};
  let cleaned = false;
  const reports: [unknown, boolean][] = [];
  d.invocationCleanup = () => { cleaned = true; };
  d.reportExceptionToConsole = (error) => { reports.push([error, cleaned]); };
  d.runtime.onerror = () => { throw inner; };
  assert.doesNotThrow(() => d.report(outer));
  assert.deepEqual(reports, [[inner, true], [outer, true]]);
  assert.equal(d.events.length, 1, "returned callback exception observes the reporting guard");
  assert.equal(d.events[0]?.defaultPrevented, false);
});

test("global handler invocation failures cross as values and re-enter exception reporting", (t) => {
  const d = driver(t);
  const inner = {};
  const outer = {};
  d.invokeGlobalHandler = () => ({ ok: false, error: inner });
  d.runtime.onerror = () => { throw new Error("source bypassed the provider invocation"); };
  assert.doesNotThrow(() => d.report(outer));
  assert.deepEqual(d.errors, [inner, outer]);
  assert.equal(d.events.length, 1);
  assert.equal(d.events[0]?.defaultPrevented, false);
});

test("global handler invocation can skip an inactive callback without changing its slot", (t) => {
  const d = driver(t);
  let invoked = 0;
  let cleaned = 0;
  const handler = () => { invoked++; return true; };
  d.runtime.onerror = handler;
  d.inactiveHandlers.add(handler);
  d.invocationCleanup = () => { cleaned++; };
  d.report("inactive");
  assert.equal(invoked, 0);
  assert.equal(cleaned, 0);
  assert.equal(d.events[0]?.defaultPrevented, false);
  assert.equal(d.runtime.onerror, handler);
  assert.deepEqual(d.errors, ["inactive"]);
  d.inactiveHandlers.delete(handler);
  d.report("active");
  assert.equal(invoked, 1);
  assert.equal(cleaned, 1);
  assert.equal(d.events[1]?.defaultPrevented, true);
  assert.equal(d.listeners.filter((listener) => !listener.removed).length, 1);
  assert.deepEqual(d.errors, ["inactive"]);
});

test("global handler context is captured at assignment and retained across later invocation contexts", (t) => {
  const d = driver(t);
  const assignment = {};
  const firstDispatch = {};
  const secondDispatch = {};
  const handler = () => true;
  d.incumbentContext = assignment;
  d.runtime.onerror = handler;
  d.incumbentContext = firstDispatch;
  d.report("first");
  d.incumbentContext = secondDispatch;
  d.report("second");
  assert.deepEqual(d.capturedContexts, [assignment]);
  assert.equal(d.invocations[0]?.context, assignment);
  assert.equal(d.invocations[1]?.context, assignment);
  assert.notEqual(d.invocations[0]?.context, firstDispatch);
  assert.notEqual(d.invocations[1]?.context, secondDispatch);
  assert.deepEqual(d.reads, ["onerror", "onerror"]);
});

test("global handler context is independent when the same callback is assigned to different attributes", (t) => {
  const d = driver(t);
  const errorAssignment = {};
  const rejectionAssignment = {};
  const dispatchContext = {};
  const handler = () => undefined;
  d.incumbentContext = errorAssignment;
  d.runtime.onerror = handler;
  d.incumbentContext = rejectionAssignment;
  d.runtime.onunhandledrejection = handler;
  d.incumbentContext = dispatchContext;
  d.report("error");
  d.runtime.hostPromiseRejectionTracker(d.promise("rejection"), "reject");
  d.runtime.notifyRejectedPromises();
  d.task();
  assert.equal(d.invocations[0]?.callback, handler);
  assert.equal(d.invocations[1]?.callback, handler);
  assert.equal(d.invocations[0]?.context, errorAssignment);
  assert.equal(d.invocations[1]?.context, rejectionAssignment);
  assert.deepEqual(d.capturedContexts, [errorAssignment, rejectionAssignment]);
});

test("global handler context is recaptured on identical assignment without moving its listener", (t) => {
  const d = driver(t);
  const firstAssignment = {};
  const replacementAssignment = {};
  const reactivationAssignment = {};
  const order: string[] = [];
  const handler = () => { order.push("handler"); return true; };
  d.addGlobalEventListener("error", () => { order.push("before"); });
  d.incumbentContext = firstAssignment;
  d.runtime.onerror = handler;
  d.addGlobalEventListener("error", () => { order.push("after"); });
  d.incumbentContext = replacementAssignment;
  d.runtime.onerror = handler;
  d.report("replacement");
  assert.deepEqual(order, ["before", "handler", "after"]);
  assert.equal(d.invocations[0]?.context, replacementAssignment);
  assert.deepEqual(d.capturedContexts, [firstAssignment, replacementAssignment]);
  order.length = 0;
  d.runtime.onerror = null;
  d.incumbentContext = reactivationAssignment;
  d.runtime.onerror = handler;
  d.report("reactivation");
  assert.deepEqual(order, ["before", "after", "handler"]);
  assert.equal(d.invocations[1]?.context, reactivationAssignment);
  assert.deepEqual(d.capturedContexts, [firstAssignment, replacementAssignment, reactivationAssignment]);
});

test("global handler context captures non-callable objects but not nullable primitive conversions", (t) => {
  const d = driver(t);
  const assignment = {};
  const object = {};
  d.incumbentContext = assignment;
  d.runtime.onerror = object;
  assert.equal(d.runtime.onerror, object);
  assert.deepEqual(d.capturedContexts, [assignment]);
  d.report("non-callable");
  assert.equal(d.invocations.length, 0);
  for (const value of [null, undefined, false, 0, "handler", Symbol("handler")]) {
    d.runtime.onerror = value as object | null;
    assert.equal(d.runtime.onerror, null);
  }
  assert.deepEqual(d.capturedContexts, [assignment]);
  assert.equal(d.listeners.filter((listener) => !listener.removed).length, 0);
});

test("global handler context survives self-reassignment for the invocation already in progress", (t) => {
  const d = driver(t);
  const firstAssignment = {};
  const nextAssignment = {};
  const cleanedContexts: object[] = [];
  const handler = () => {
    if (d.invocations.length === 1) {
      d.incumbentContext = nextAssignment;
      d.runtime.onerror = handler;
    }
    return true;
  };
  d.invocationCleanup = () => { cleanedContexts.push(d.invocations.at(-1)!.context); };
  d.incumbentContext = firstAssignment;
  d.runtime.onerror = handler;
  d.report("first");
  d.report("next");
  assert.equal(cleanedContexts[0], firstAssignment);
  assert.equal(cleanedContexts[1], nextAssignment);
  assert.deepEqual(d.capturedContexts, [firstAssignment, nextAssignment]);
  assert.equal(d.listeners.filter((listener) => !listener.removed).length, 1);
});

test("an ErrorEvent dispatched as unhandledrejection still uses ordinary handler processing", (t) => {
  const d = driver(t);
  const event = new ErrorEvent("unhandledrejection", { cancelable: true });
  d.runtime.onunhandledrejection = function (...args: unknown[]) {
    assert.equal(this, globalThis);
    assert.deepEqual(args, [event]);
    return false;
  };
  assert.equal(d.dispatchGlobalEvent(event, (error) => d.runtime.reportException(error)), false);
});

test("global handlers set the canceled flag without invoking a subclass override", (t) => {
  const d = driver(t);
  let calls = 0;
  class OverriddenEvent extends ErrorEvent {
    override preventDefault(): void { calls++; }
  }
  d.runtime.onerror = () => true;
  d.runtime.onunhandledrejection = () => false;
  for (const type of ["error", "unhandledrejection"]) {
    const event = new OverriddenEvent(type, { cancelable: true });
    event.preventDefault();
    assert.equal(calls, 1, "the public override is active");
    assert.equal(event.defaultPrevented, false);
    calls = 0;
    assert.equal(d.dispatchGlobalEvent(event, (error) => d.runtime.reportException(error)), false);
    assert.equal(event.defaultPrevented, true);
    assert.equal(calls, 0);
    const fixed = new OverriddenEvent(type, { cancelable: false });
    assert.equal(d.dispatchGlobalEvent(fixed, (error) => d.runtime.reportException(error)), true);
    assert.equal(fixed.defaultPrevented, false);
    assert.equal(calls, 0);
  }
});

test("handler replacement preserves registration order and reactivation moves it", (t) => {
  const d = driver(t);
  const order: string[] = [];
  d.addGlobalEventListener("error", () => { order.push("before"); });
  d.runtime.onerror = () => { order.push("old"); };
  d.addGlobalEventListener("error", () => { order.push("after"); });
  d.runtime.onerror = () => { order.push("replacement"); };
  d.report("first");
  assert.deepEqual(order, ["before", "replacement", "after"]);
  order.length = 0;
  d.runtime.onerror = null;
  d.runtime.onerror = () => { order.push("reactivated"); };
  d.report("second");
  assert.deepEqual(order, ["before", "after", "reactivated"]);
});

test("handlers retain non-callable objects and turn primitives into null", (t) => {
  const d = driver(t);
  const object = {};
  d.runtime.onerror = object;
  assert.equal(d.runtime.onerror, object);
  d.report("non-callable");
  assert.deepEqual(d.errors, ["non-callable"]);
  for (const value of [1, false, "code", undefined, null]) {
    d.runtime.onerror = value as object | null;
    assert.equal(d.runtime.onerror, null);
  }
  assert.equal(d.listeners.filter((listener) => !listener.removed).length, 0);
});

test("a current global handler is read once instead of invoking a captured old value", (t) => {
  const d = driver(t);
  let count = 0;
  d.runtime.onerror = () => { throw new Error("old handler was invoked"); };
  Object.defineProperty(globalThis, "onerror", {
    configurable: true,
    get() { count++; return () => true; },
  });
  d.report("handled");
  assert.equal(count, 1);
  assert.deepEqual(d.errors, []);
});

test("handler invocation does not consult an overwritten public call property", (t) => {
  const d = driver(t);
  const handler = () => true;
  Object.defineProperty(handler, "call", { get() { throw new Error("call was read"); } });
  d.runtime.onerror = handler;
  d.report("handled");
  assert.deepEqual(d.errors, []);
});

test("throwing inside onerror suppresses nested error dispatch and still reports both values", (t) => {
  const d = driver(t);
  const inner = {};
  const outer = {};
  d.runtime.onerror = () => { throw inner; };
  d.report(outer);
  assert.equal(d.events.length, 1);
  assert.deepEqual(d.errors, [inner, outer]);
  d.runtime.onerror = () => true;
  d.report("next");
  assert.equal(d.events.length, 2, "reporting mode resets after dispatch");
  assert.deepEqual(d.errors, [inner, outer]);
});

test("explicit nested reportError reports the inner value without recursively dispatching", (t) => {
  const d = driver(t);
  d.runtime.onerror = () => { d.report("inner"); return true; };
  d.report("outer");
  assert.equal(d.events.length, 1);
  assert.deepEqual(d.extractions, ["outer", "inner"]);
  assert.deepEqual(d.errors, ["inner"]);
});

test("muted errors sanitize event information but console reporting retains the original value", (t) => {
  const d = driver(t);
  d.information = { ...d.information, muted: true };
  const error = {};
  d.report(error);
  const event = d.events[0];
  assert.ok(event instanceof ErrorEvent);
  assert.deepEqual([event.message, event.filename, event.lineno, event.colno, event.error],
    ["Script error.", "", 0, 0, null]);
  assert.equal(d.errors[0], error);
});

test("omitError hides the event value while preserving its diagnostic fields", (t) => {
  const d = driver(t);
  d.runtime.reportException("hidden", true);
  const event = d.events[0];
  assert.ok(event instanceof ErrorEvent);
  assert.equal(event.error, null);
  assert.equal(event.message, d.information.message);
  assert.deepEqual(d.errors, ["hidden"]);
});

test("preventDefault from an ordinary listener suppresses default exception reporting", (t) => {
  const d = driver(t);
  d.addGlobalEventListener("error", (event) => event.preventDefault());
  d.report(undefined);
  assert.deepEqual(d.errors, []);
});

test("a dedicated worker queues sanitized owner events and propagates only uncanceled reports", (t) => {
  const d = driver(t);
  const parentTasks: (() => void)[] = [];
  const parentEvents: ErrorEvent[] = [];
  const parentReports: unknown[][] = [];
  let canceled = false;
  d.dedicatedWorkerOwner = {
    enqueueGlobalTask(task) { parentTasks.push(task); },
    dispatchWorkerError(event) { parentEvents.push(event); return !canceled; },
    reportException(error, omitError) { parentReports.push([error, omitError]); },
  };
  const error = {};
  d.report(error);
  assert.deepEqual(d.errors, []);
  assert.equal(parentEvents.length, 0);
  parentTasks.shift()!();
  assert.equal(parentEvents[0]?.error, null);
  assert.equal(parentEvents[0]?.message, d.information.message);
  assert.deepEqual(parentReports, [[error, true]]);
  canceled = true;
  d.report("canceled at owner");
  parentTasks.shift()!();
  assert.equal(parentReports.length, 1);
});

test("an empty rejection checkpoint does not queue a task", (t) => {
  const d = driver(t);
  d.runtime.notifyRejectedPromises();
  assert.equal(d.tasks.length, 0);
});

test("rejections queue one notification task at the checkpoint, with canonical event flags", (t) => {
  const d = driver(t);
  const reason = {};
  const promise = d.promise(reason);
  d.runtime.hostPromiseRejectionTracker(promise, "reject");
  assert.equal(d.tasks.length, 0);
  d.runtime.notifyRejectedPromises();
  assert.equal(d.tasks.length, 1);
  assert.equal(d.events.length, 0);
  d.addGlobalEventListener("unhandledrejection", (event) => {
    assert.ok(event instanceof PromiseRejectionEvent);
    assert.equal(event.promise, promise);
    assert.equal(event.reason, reason);
    assert.equal(event.target, globalThis);
    assert.equal(event.currentTarget, globalThis);
    assert.equal(event.cancelable, true);
    assert.equal(event.bubbles, false);
    assert.equal(event.isTrusted, true);
  });
  d.task();
  assert.deepEqual(d.rejections, [reason]);
});

test("handling a rejection before the checkpoint removes it without notification", (t) => {
  const d = driver(t);
  const promise = d.promise("handled");
  d.runtime.hostPromiseRejectionTracker(promise, "reject");
  d.handle(promise);
  d.runtime.notifyRejectedPromises();
  assert.equal(d.tasks.length, 0);
  assert.equal(d.events.length, 0);
});

test("handling after the snapshot but before its task is checked through Promise internal state", (t) => {
  const d = driver(t);
  const promise = d.promise("handled");
  d.runtime.hostPromiseRejectionTracker(promise, "reject");
  d.runtime.notifyRejectedPromises();
  d.handle(promise);
  d.task();
  assert.equal(d.events.length, 0);
  assert.deepEqual(d.rejections, []);
  assert.equal(d.tasks.length, 0);
});

test("handling inside unhandledrejection prevents a later rejectionhandled event", (t) => {
  const d = driver(t);
  const promise = d.promise("caught");
  d.runtime.onunhandledrejection = (event) => {
    assert.ok(event instanceof PromiseRejectionEvent);
    d.handle(event.promise);
    return false;
  };
  d.runtime.hostPromiseRejectionTracker(promise, "reject");
  d.runtime.notifyRejectedPromises();
  d.task();
  assert.deepEqual(d.events.map((event) => event.type), ["unhandledrejection"]);
  assert.deepEqual(d.rejections, []);
  assert.equal(d.tasks.length, 0);
  d.handle(promise);
  assert.equal(d.tasks.length, 0);
});

test("a late handler queues one non-cancelable rejectionhandled event with the original reason", (t) => {
  const d = driver(t);
  const reason = Symbol("reason");
  const promise = d.promise(reason);
  d.runtime.hostPromiseRejectionTracker(promise, "reject");
  d.runtime.notifyRejectedPromises();
  d.task();
  d.runtime.onrejectionhandled = function (event) {
    assert.equal(this, globalThis);
    assert.ok(event instanceof PromiseRejectionEvent);
    assert.equal(event.promise, promise);
    assert.equal(event.reason, reason);
    assert.equal(event.cancelable, false);
    return false;
  };
  d.handle(promise);
  d.handle(promise);
  assert.equal(d.tasks.length, 1);
  d.task();
  assert.deepEqual(d.events.map((event) => event.type), ["unhandledrejection", "rejectionhandled"]);
  assert.equal(d.events[1]?.defaultPrevented, false);
});

test("muted host rejection notifications do not expose reason or promise", (t) => {
  const d = driver(t);
  const promise = d.promise("muted");
  d.runtime.hostPromiseRejectionTracker(promise, "reject", true);
  d.runtime.hostPromiseRejectionTracker(promise, "handle", true);
  d.runtime.notifyRejectedPromises();
  assert.equal(d.tasks.length, 0);
  assert.equal(d.events.length, 0);
  assert.deepEqual(d.rejections, []);
});

test("rejections created during notification belong to the next snapshot", (t) => {
  const d = driver(t);
  const first = d.promise("first");
  const second = d.promise("second");
  d.runtime.onunhandledrejection = (event) => {
    assert.ok(event instanceof PromiseRejectionEvent);
    if (event.promise === first) d.runtime.hostPromiseRejectionTracker(second, "reject");
  };
  d.runtime.hostPromiseRejectionTracker(first, "reject");
  d.runtime.notifyRejectedPromises();
  d.task();
  assert.deepEqual(d.rejections, ["first"]);
  assert.equal(d.tasks.length, 0);
  d.runtime.notifyRejectedPromises();
  d.task();
  assert.deepEqual(d.rejections, ["first", "second"]);
});

test("each promise in a notification batch checks whether earlier callbacks handled it", (t) => {
  const d = driver(t);
  const first = d.promise("first");
  const second = d.promise("second");
  d.runtime.onunhandledrejection = () => { d.handle(second); };
  d.runtime.hostPromiseRejectionTracker(first, "reject");
  d.runtime.hostPromiseRejectionTracker(second, "reject");
  d.runtime.notifyRejectedPromises();
  d.task();
  assert.deepEqual(d.rejections, ["first"]);
  assert.equal(d.events.length, 1);
});

test("throwing inside a rejection handler reports an error and continues notification", (t) => {
  const d = driver(t);
  const thrown = {};
  d.runtime.onunhandledrejection = () => { throw thrown; };
  d.runtime.onerror = () => true;
  d.runtime.hostPromiseRejectionTracker(d.promise("first"), "reject");
  d.runtime.hostPromiseRejectionTracker(d.promise("second"), "reject");
  d.runtime.notifyRejectedPromises();
  d.task();
  assert.deepEqual(d.extractions, [thrown, thrown]);
  assert.deepEqual(d.events.map((event) => event.type), ["unhandledrejection", "error", "unhandledrejection", "error"]);
  assert.deepEqual(d.errors, []);
  assert.deepEqual(d.rejections, ["first", "second"]);
});

test("opaque promises are never inspected through then or custom property getters", (t) => {
  const d = driver(t);
  const promise = d.promise(undefined, {
    get then(): never { throw new Error("then was read"); },
    get result(): never { throw new Error("result was read"); },
    get handled(): never { throw new Error("handled was read"); },
  });
  d.runtime.hostPromiseRejectionTracker(promise, "reject");
  d.runtime.notifyRejectedPromises();
  d.task();
  assert.deepEqual(d.rejections, [undefined]);
  d.handle(promise);
  d.task();
  const event = d.events[1];
  assert.ok(event instanceof PromiseRejectionEvent);
  assert.equal(event.promise, promise);
  assert.equal(event.reason, undefined);
});

test("canceled unhandled notifications still enter the outstanding weak set", (t) => {
  const d = driver(t);
  const promise = d.promise("canceled");
  d.runtime.onunhandledrejection = () => false;
  d.runtime.hostPromiseRejectionTracker(promise, "reject");
  d.runtime.notifyRejectedPromises();
  d.task();
  assert.deepEqual(d.rejections, []);
  d.handle(promise);
  d.task();
  assert.deepEqual(d.events.map((event) => event.type), ["unhandledrejection", "rejectionhandled"]);
});

test("a truthy unhandled handler return does not cancel its ordinary event", (t) => {
  const d = driver(t);
  d.runtime.onunhandledrejection = () => true;
  d.runtime.hostPromiseRejectionTracker(d.promise("not canceled"), "reject");
  d.runtime.notifyRejectedPromises();
  d.task();
  assert.deepEqual(d.rejections, ["not canceled"]);
});
