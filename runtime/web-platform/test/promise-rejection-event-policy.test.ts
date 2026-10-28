import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import { createHostNodePrimitives } from "../host/node-primitives.ts";
import { Event, EventTarget } from "../src/core/events.ts";
import { PromiseRejectionEvent } from "../src/core/promise-rejection-event.ts";
import type { PromiseRejectionEventInit } from "../src/core/promise-rejection-event.ts";
import { WebPlatformRuntime } from "../src/provider/web-platform-runtime.ts";
import { installWebPlatformRuntime } from "../src/provider/environment.ts";

// HTML #the-promiserejectionevent-interface; Web IDL #es-dictionary and #es-object.
function construct(type: unknown, init: unknown): PromiseRejectionEvent {
  return new PromiseRejectionEvent(type as string, init as PromiseRejectionEventInit);
}

test("PromiseRejectionEvent has the canonical Event ancestry and plain public surface", () => {
  const promise = Promise.resolve(1);
  const event = new PromiseRejectionEvent("unhandledrejection", { promise });
  assert.ok(event instanceof Event);
  assert.ok(event instanceof PromiseRejectionEvent);
  assert.equal(PromiseRejectionEvent.length, 2);
  assert.equal(Object.prototype.toString.call(event), "[object PromiseRejectionEvent]");
  assert.equal(event.type, "unhandledrejection");
  assert.equal(event.promise, promise);
  assert.equal(event.reason, undefined);
  assert.equal(event.bubbles, false);
  assert.equal(event.cancelable, false);
  assert.equal(event.composed, false);
  assert.equal(event.isTrusted, false);
});

test("PromiseRejectionEvent rejects missing arguments before any conversion", () => {
  const context = createContext({ PromiseRejectionEvent, assert });
  runInContext(`
    let reads = 0;
    const type = { toString() { reads++; return "x"; } };
    assert.throws(() => new PromiseRejectionEvent(), { name: "TypeError" });
    assert.throws(() => new PromiseRejectionEvent(type), { name: "TypeError" });
    assert.equal(reads, 0);
    assert.throws(() => PromiseRejectionEvent("x", { promise: {} }), { name: "TypeError" });
  `, context);
});

for (const init of [undefined, null, {}, { promise: undefined }]) {
  test(`PromiseRejectionEvent rejects an absent required promise: ${String(init)}`, () => {
    assert.throws(() => construct("x", init), TypeError);
  });
}

for (const promise of [null, true, false, 0, 1, "promise", 1n, Symbol("promise")]) {
  test(`PromiseRejectionEvent object conversion rejects ${String(promise)}`, () => {
    let reasonRead = false;
    const init = { promise, get reason() { reasonRead = true; return 1; } };
    assert.throws(() => construct("x", init), TypeError);
    assert.equal(reasonRead, false);
  });
}

test("PromiseRejectionEvent accepts any object or function without assimilation", () => {
  const reason = {};
  const values: object[] = [{}, [], () => 1, new Date(0), new Number(2), {
    get then(): never { throw new Error("then must not be read"); },
  }];
  const foreign = runInContext("({ value: 1 })", createContext({})) as object;
  values.push(foreign);
  for (const promise of values) {
    const event = new PromiseRejectionEvent("x", { promise, reason });
    assert.equal(event.promise, promise);
    assert.equal(event.reason, reason);
  }
});

test("PromiseRejectionEvent retains every reason without conversion", () => {
  const promise = {};
  const reasons: unknown[] = [undefined, null, false, 0, -0, NaN, Infinity, 1n, Symbol("reason"), {}, () => 0];
  for (const reason of reasons) {
    assert.ok(Object.is(new PromiseRejectionEvent("x", { promise, reason }).reason, reason));
  }
});

test("PromiseRejectionEvent performs inherited then derived dictionary reads once", () => {
  const order: string[] = [];
  const promise = {};
  const reason = {};
  const type = { toString() { order.push("type"); return "x"; } };
  const init = {
    get bubbles() { order.push("bubbles"); return 1; },
    get cancelable() { order.push("cancelable"); return 1; },
    get composed() { order.push("composed"); return 1; },
    get promise() { order.push("promise"); return promise; },
    get reason() { order.push("reason"); return reason; },
  };
  const event = construct(type, init);
  assert.deepEqual(order, ["type", "bubbles", "cancelable", "composed", "promise", "reason"]);
  assert.equal(event.bubbles, true);
  assert.equal(event.cancelable, true);
  assert.equal(event.composed, true);
  assert.equal(event.promise, promise);
  assert.equal(event.reason, reason);
});

test("PromiseRejectionEvent reads inherited members from an ordinary class instance", () => {
  const promise = {};
  class Init {
    get promise(): object { return promise; }
    get reason(): string { return "inherited"; }
    get bubbles(): boolean { return true; }
  }
  const event = new PromiseRejectionEvent("x", new Init());
  assert.equal(event.promise, promise);
  assert.equal(event.reason, "inherited");
  assert.equal(event.bubbles, true);
});

test("PromiseRejectionEvent preserves dictionary getter failures and stops conversion", () => {
  const failure = {};
  let later = false;
  const init = {
    get promise(): object { throw failure; },
    get reason(): unknown { later = true; return 0; },
  };
  assert.throws(() => new PromiseRejectionEvent("x", init), (error: unknown) => error === failure);
  assert.equal(later, false);
  const reasonFailure = { promise: {}, get reason(): unknown { throw failure; } };
  assert.throws(() => new PromiseRejectionEvent("x", reasonFailure), (error: unknown) => error === failure);
});

test("PromiseRejectionEvent rejects primitive dictionaries and Symbol event types", () => {
  for (const init of [false, 1, "init", 1n, Symbol("init")]) {
    assert.throws(() => construct("x", init), TypeError);
  }
  let reads = 0;
  assert.throws(() => construct(Symbol("type"), { get promise() { reads++; return {}; } }), TypeError);
  assert.equal(reads, 0);
});

test("PromiseRejectionEvent subclassing retains private data and Event dispatch", () => {
  class Derived extends PromiseRejectionEvent {}
  const promise = {}, reason = {};
  const event = new Derived("unhandledrejection", { promise, reason, cancelable: true });
  const target = new EventTarget();
  target.addEventListener("unhandledrejection", (received) => {
    assert.equal(received, event);
    assert.equal(received.target, target);
    received.preventDefault();
  });
  assert.equal(target.dispatchEvent(event), false);
  assert.equal(event.promise, promise);
  assert.equal(event.reason, reason);
  assert.equal(event.isTrusted, false);
});

test("PromiseRejectionEvent captures the timestamp only after successful conversion", async () => {
  const order: string[] = [];
  const primitives = createHostNodePrimitives();
  const runtime = new WebPlatformRuntime({
    ...primitives,
    monotonicMilliseconds() { order.push("timestamp"); return 123.5; },
  });
  installWebPlatformRuntime(runtime);
  try {
    const event = new PromiseRejectionEvent("x", {
      get promise() { order.push("promise"); return {}; },
      get reason() { order.push("reason"); return 1; },
    });
    assert.deepEqual(order, ["promise", "reason", "timestamp"]);
    assert.equal(event.timeStamp, 123.5);
    order.length = 0;
    assert.throws(() => construct("x", { promise: null }), TypeError);
    assert.deepEqual(order, []);
  } finally {
    await runtime.close();
  }
});

test("PromiseRejectionEvent descriptor flags are outside the fixed-layout profile", {
  skip: "nts class layouts declare members plainly; Web IDL writable/enumerable/configurable flags await descriptor support",
}, () => {});
