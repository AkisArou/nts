import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { AbortController } from "../src/core/abort.ts";
import { createHostNodePrimitives } from "../host/node-primitives.ts";
import { WebPlatformRuntime } from "../src/provider.ts";
import {
  currentWebPlatformRuntime,
  hasWebPlatformRuntime,
  installWebPlatformRuntime,
} from "../src/provider/environment.ts";

import {
  CustomEvent,
  Event,
  EventTarget,
  addInternalEventListener,
  eventTargetSetErrorReporter,
} from "../src/core/events.ts";
import type { CustomEventInit } from "../src/core/events.ts";

test("listener errors without an installed runtime remain nonthrowing", () => {
  assert.equal(hasWebPlatformRuntime(), false);
  const target = new EventTarget();
  let followingCalls = 0;
  target.addEventListener("x", () => { throw new Error("no provider installed"); });
  target.addEventListener("x", () => { followingCalls++; });

  assert.doesNotThrow(() => target.dispatchEvent(new Event("x")));
  assert.equal(followingCalls, 1);
});

// DOM, dispatch and inner invoke:
// https://dom.spec.whatwg.org/#concept-event-dispatch
// https://dom.spec.whatwg.org/#concept-event-inner-invoke
test("a bare EventTarget invokes capture listeners before non-capture listeners", () => {
  for (const bubbles of [false, true]) {
    const target = new EventTarget();
    const order: string[] = [];
    target.addEventListener("x", (event) => {
      assert.equal(event.eventPhase, Event.AT_TARGET);
      order.push("bubble");
    });
    target.addEventListener("x", (event) => {
      assert.equal(event.eventPhase, Event.AT_TARGET);
      order.push("capture");
    }, true);

    target.dispatchEvent(new Event("x", { bubbles }));
    assert.deepEqual(order, ["capture", "bubble"]);
  }
});

test("each invocation snapshots listeners independently at the target", () => {
  const target = new EventTarget();
  const order: string[] = [];
  const lateCapture = (): void => { order.push("late capture"); };
  const lateBubble = (): void => { order.push("late bubble"); };
  target.addEventListener("x", () => {
    order.push("capture");
    target.addEventListener("x", lateCapture, true);
    target.addEventListener("x", lateBubble);
  }, true);
  target.addEventListener("x", () => { order.push("bubble"); });

  target.dispatchEvent(new Event("x"));
  assert.deepEqual(order, ["capture", "bubble", "late bubble"]);
  order.length = 0;
  target.dispatchEvent(new Event("x"));
  assert.deepEqual(order, ["capture", "late capture", "bubble", "late bubble"]);
});

test("capture stopPropagation finishes its invocation but suppresses the next", () => {
  const target = new EventTarget();
  const order: string[] = [];
  target.addEventListener("x", (event) => {
    order.push("first capture");
    event.stopPropagation();
  }, true);
  target.addEventListener("x", () => { order.push("second capture"); }, true);
  target.addEventListener("x", () => { order.push("bubble"); });

  target.dispatchEvent(new Event("x"));
  assert.deepEqual(order, ["first capture", "second capture"]);
});

test("an event stopped before dispatch skips listeners and can be dispatched again", () => {
  const target = new EventTarget();
  const order: string[] = [];
  target.addEventListener("x", () => { order.push("capture"); }, true);
  target.addEventListener("x", () => { order.push("bubble"); });
  const event = new Event("x");
  event.stopPropagation();

  target.dispatchEvent(event);
  assert.deepEqual(order, []);
  target.dispatchEvent(event);
  assert.deepEqual(order, ["capture", "bubble"]);
});

test("internal resisting listeners remain reachable after a capture listener stops dispatch", () => {
  const target = new EventTarget();
  const order: string[] = [];
  target.addEventListener("x", (event) => {
    order.push("capture");
    event.stopImmediatePropagation();
  }, true);
  target.addEventListener("x", () => { order.push("later capture"); }, true);
  target.addEventListener("x", () => { order.push("bubble"); });
  addInternalEventListener(target, "x", () => { order.push("internal"); }, {
    resistStopPropagation: true,
  });

  target.dispatchEvent(new Event("x"));
  assert.deepEqual(order, ["capture", "internal"]);
});

// DOM removeEventListener searches the current listener list, not records that
// were already removed from it: https://dom.spec.whatwg.org/#dom-eventtarget-removeeventlistener
for (const removeAgain of [false, true]) {
  test(`a listener removed and re-added during dispatch is ${removeAgain ? "removable" : "retained"}`, () => {
    const target = new EventTarget();
    let calls = 0;
    const listener = (): void => { calls++; };
    target.addEventListener("x", () => {
      target.removeEventListener("x", listener);
      target.addEventListener("x", listener);
      if (removeAgain) target.removeEventListener("x", listener);
    }, { once: true });
    target.addEventListener("x", listener);

    target.dispatchEvent(new Event("x"));
    assert.equal(calls, 0, "the new listener is outside the current invocation's snapshot");
    target.dispatchEvent(new Event("x"));
    assert.equal(calls, removeAgain ? 0 : 1);
  });
}

// DOM initialize clears trust, but initEvent is a no-op during dispatch:
// https://dom.spec.whatwg.org/#concept-event-initialize
// https://dom.spec.whatwg.org/#dom-event-initevent
test("initEvent clears trust on a completed provider-created event", () => {
  const controller = new AbortController();
  const events: Event[] = [];
  controller.signal.addEventListener("abort", (event) => { events.push(event); });
  controller.abort();
  const event = events[0];
  assert.ok(event !== undefined);
  assert.equal(event.isTrusted, true);

  event.initEvent("reinitialized", true, true);
  assert.equal(event.isTrusted, false);
  assert.equal(event.target, null);
  assert.equal(event.type, "reinitialized");
});

test("initEvent preserves trust while the event is dispatching", () => {
  const controller = new AbortController();
  let calls = 0;
  controller.signal.addEventListener("abort", (event) => {
    assert.equal(event.isTrusted, true);
    event.initEvent("ignored", true, true);
    assert.equal(event.isTrusted, true);
    assert.equal(event.type, "abort");
    calls++;
  });
  controller.abort();
  assert.equal(calls, 1);
});

// Web IDL attributes and operations require an object implementing the interface.
// The corresponding DOM algorithms use internal state, not overridable accessors.
// https://webidl.spec.whatwg.org/#es-attributes
// https://webidl.spec.whatwg.org/#es-operations
test("Event getters reject receivers without Event internal state", () => {
  const event = new Event("x");
  for (const name of [
    "type", "target", "srcElement", "currentTarget", "eventPhase", "bubbles",
    "cancelable", "returnValue", "defaultPrevented", "composed", "timeStamp", "cancelBubble",
  ] as const) {
    const get = Object.getOwnPropertyDescriptor(Event.prototype, name)?.get;
    assert.ok(get !== undefined, name);
    assert.equal(get.call(event), event[name]);
    assert.throws(() => get.call({}), TypeError, name);
    assert.throws(() => get.call(Object.create(Event.prototype)), TypeError, name);
  }
  const trusted = Object.getOwnPropertyDescriptor(event, "isTrusted")?.get;
  assert.ok(trusted !== undefined);
  assert.equal(trusted.call(event), false);
  assert.throws(() => trusted.call({}), TypeError);
});

test("Event setters reject an invalid receiver even when their value is a no-op", () => {
  const returnValue = Object.getOwnPropertyDescriptor(Event.prototype, "returnValue")?.set;
  const cancelBubble = Object.getOwnPropertyDescriptor(Event.prototype, "cancelBubble")?.set;
  assert.ok(returnValue !== undefined && cancelBubble !== undefined);
  assert.throws(() => returnValue.call({}, true), TypeError);
  assert.throws(() => cancelBubble.call({}, false), TypeError);
});

test("Event and EventTarget validate the receiver before argument conversion", () => {
  const wrongEvent = {} as Event;
  const wrongTarget = {} as EventTarget;
  let conversions = 0;
  const type = {
    toString(): string {
      conversions++;
      return "x";
    },
  } as unknown as string;
  assert.throws(() => Event.prototype.initEvent.call(wrongEvent, type), TypeError);
  assert.throws(() => EventTarget.prototype.addEventListener.call(wrongTarget, type, null), TypeError);
  assert.throws(() => EventTarget.prototype.removeEventListener.call(wrongTarget, type, null), TypeError);
  assert.equal(conversions, 0);
});

test("dispatchEvent rejects an Event prototype without initialized internal state", () => {
  const target = new EventTarget();
  assert.equal(target.dispatchEvent(new Event("x")), true);
  assert.throws(() => target.dispatchEvent(Object.create(Event.prototype)), TypeError);
});

test("CustomEvent requires its own brand for detail and initCustomEvent", () => {
  const get = Object.getOwnPropertyDescriptor(CustomEvent.prototype, "detail")?.get;
  assert.ok(get !== undefined);
  const custom = new CustomEvent("x", { detail: 42 });
  assert.equal(get.call(custom), 42);
  assert.throws(() => get.call(new Event("x")), TypeError);
  assert.throws(() => CustomEvent.prototype.initCustomEvent.call({} as CustomEvent, "x"), TypeError);
  const ordinary = new Event("original");
  assert.throws(() => CustomEvent.prototype.initCustomEvent.call(ordinary as CustomEvent, "changed"), TypeError);
  assert.equal(ordinary.type, "original");
});

test("event and target expandos cannot replace their internal state", () => {
  const event = new Event("x", { cancelable: true });
  const eventProperties = event as unknown as Record<string, unknown>;
  eventProperties.eventType = "forged";
  eventProperties.eventCancelable = false;
  eventProperties.canceled = true;
  eventProperties.dispatching = true;
  const target = new EventTarget();
  let calls = 0;
  target.addEventListener("x", () => { calls++; });
  const targetProperties = target as unknown as Record<string, unknown>;
  targetProperties.listeners = [];

  assert.equal(event.type, "x");
  assert.equal(event.cancelable, true);
  assert.equal(event.defaultPrevented, false);
  assert.equal(target.dispatchEvent(event), true);
  assert.equal(calls, 1);
});

test("dispatch uses event state even when public accessors are overridden", () => {
  class OverriddenEvent extends Event {
    override get type(): string { return "shadow"; }
    override get defaultPrevented(): boolean { return true; }
  }
  const event = new OverriddenEvent("actual");
  const target = new EventTarget();
  const order: string[] = [];
  target.addEventListener("actual", () => { order.push("actual"); });
  target.addEventListener("shadow", () => { order.push("shadow"); });

  assert.equal(target.dispatchEvent(event), true);
  assert.deepEqual(order, ["actual"]);
  assert.equal(event.type, "shadow", "the script accessor remains observable to script");
  assert.equal(event.defaultPrevented, true);
});

test("the returnValue setter sets the canceled flag without calling preventDefault", () => {
  let calls = 0;
  class OverriddenEvent extends Event {
    override preventDefault(): void { calls++; }
  }
  const event = new OverriddenEvent("x", { cancelable: true });
  event.returnValue = false;

  assert.equal(calls, 0);
  assert.equal(event.defaultPrevented, true);
  assert.equal(new EventTarget().dispatchEvent(event), false);
});

// Web IDL constants: https://webidl.spec.whatwg.org/#es-constants
test("Event constants have immutable descriptors on the interface and prototype", () => {
  for (const [name, value] of [
    ["NONE", 0],
    ["CAPTURING_PHASE", 1],
    ["AT_TARGET", 2],
    ["BUBBLING_PHASE", 3],
  ] as const) {
    for (const owner of [Event, Event.prototype]) {
      assert.deepEqual(Object.getOwnPropertyDescriptor(owner, name), {
        value,
        writable: false,
        enumerable: true,
        configurable: false,
      });
    }
  }
});

// Web IDL calls the callback, not its overridable `call` property:
// https://webidl.spec.whatwg.org/#call-a-user-objects-operation
// https://webidl.spec.whatwg.org/#invoke-a-callback-function
test("function listeners ignore an own call property and receive the target", () => {
  const target = new EventTarget();
  const event = new Event("x");
  const calls: { receiver: unknown; event: Event }[] = [];
  let shadowCalls = 0;
  const listener = Object.assign(function (this: unknown, event: Event): void {
    calls.push({ receiver: this, event });
  }, {
    call(): void { shadowCalls++; },
  });
  target.addEventListener("x", listener, true);
  target.addEventListener("x", listener);

  target.dispatchEvent(event);
  assert.equal(shadowCalls, 0);
  assert.deepEqual(calls, [
    { receiver: target, event },
    { receiver: target, event },
  ]);
});

test("object listeners read handleEvent once and ignore the returned function's call", () => {
  const target = new EventTarget();
  const event = new Event("x");
  const calls: { receiver: unknown; event: Event }[] = [];
  let shadowCalls = 0;
  let reads = 0;
  const callback = Object.assign(function (this: unknown, event: Event): void {
    calls.push({ receiver: this, event });
  }, {
    call(): void { shadowCalls++; },
  });
  const listener = {
    get handleEvent() {
      reads++;
      return callback;
    },
  };
  target.addEventListener("x", listener);
  assert.equal(reads, 0, "the callback member is read at invocation time");

  target.dispatchEvent(event);
  assert.equal(reads, 1);
  assert.equal(shadowCalls, 0);
  assert.deepEqual(calls, [{ receiver: listener, event }]);
});

test("event handler attributes ignore an own call property on their callback", () => {
  const controller = new AbortController();
  const calls: { receiver: unknown; event: Event }[] = [];
  let shadowCalls = 0;
  controller.signal.onabort = Object.assign(function (this: unknown, event: Event): void {
    calls.push({ receiver: this, event });
  }, {
    call(): void { shadowCalls++; },
  });

  controller.abort();
  assert.equal(shadowCalls, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.receiver, controller.signal);
  assert.equal(calls[0]?.event.type, "abort");
});

function installEventClock(
  t: TestContext,
  readClock: () => number,
  reportError?: (error: unknown) => void,
): void {
  const previous = hasWebPlatformRuntime() ? currentWebPlatformRuntime() : null;
  const runtime = new WebPlatformRuntime({
    ...createHostNodePrimitives({}, reportError),
    monotonicMilliseconds: readClock,
  });
  installWebPlatformRuntime(runtime);
  t.after(() => {
    runtime.close();
    if (previous !== null) installWebPlatformRuntime(previous);
  });
}

// Constructor argument conversion precedes DOM's inner event creation steps.
// https://webidl.spec.whatwg.org/#es-interface-call
// https://webidl.spec.whatwg.org/#es-dictionary
// https://dom.spec.whatwg.org/#concept-event-constructor
test("CustomEvent captures its timestamp after converting the complete init dictionary", (t) => {
  const order: string[] = [];
  let now = 10;
  installEventClock(t, () => {
    order.push("clock");
    return now;
  });
  const detail = { value: 42 };
  const type = {
    toString(): string {
      order.push("type");
      now = 20;
      return "converted";
    },
  };
  const event = new CustomEvent(type as unknown as string, {
    get bubbles(): boolean { order.push("bubbles"); now = 30; return true; },
    get cancelable(): boolean { order.push("cancelable"); now = 40; return true; },
    get composed(): boolean { order.push("composed"); now = 50; return true; },
    get detail() { order.push("detail"); now = 60; return detail; },
  });

  assert.deepEqual(order, ["type", "bubbles", "cancelable", "composed", "detail", "clock"]);
  assert.equal(event.type, "converted");
  assert.equal(event.bubbles, true);
  assert.equal(event.cancelable, true);
  assert.equal(event.composed, true);
  assert.equal(event.detail, detail);
  assert.equal(event.timeStamp, 60);
  now = 100;
  assert.equal(event.timeStamp, 60, "time is captured once, after conversion");
  assert.equal(order.filter((step) => step === "clock").length, 1);
});

test("CustomEvent conversion errors occur before reading the provider clock", (t) => {
  let clockReads = 0;
  installEventClock(t, () => { clockReads++; return 10; });
  const failure = new Error("detail conversion failed");
  assert.throws(() => new CustomEvent("x", {
    get detail(): never { throw failure; },
  }), (error) => error === failure);
  assert.equal(clockReads, 0);
  assert.throws(() => new CustomEvent("x", 1 as unknown as CustomEventInit<unknown>), TypeError);
  assert.equal(clockReads, 0);
});

test("CustomEvent default dictionaries capture the clock once and retain defaults", (t) => {
  let clockReads = 0;
  installEventClock(t, () => { clockReads++; return 10; });
  const events = [
    new CustomEvent("x"),
    new CustomEvent("x", undefined),
    new CustomEvent("x", null as unknown as CustomEventInit<unknown>),
  ];
  assert.equal(clockReads, events.length);
  for (const event of events) {
    assert.equal(event.type, "x");
    assert.equal(event.bubbles, false);
    assert.equal(event.cancelable, false);
    assert.equal(event.composed, false);
    assert.equal(event.detail, null);
    assert.equal(event.timeStamp, 10);
  }
});

function eventAttribute(event: Event, name: string): unknown {
  const getter = Object.getOwnPropertyDescriptor(Event.prototype, name)?.get;
  assert.ok(getter !== undefined, `missing Event attribute: ${name}`);
  return getter.call(event);
}

// Web IDL interface identity and DOM internal state survive prototype changes.
// https://webidl.spec.whatwg.org/#es-interface
// https://dom.spec.whatwg.org/#concept-event-dispatch
test("dispatch uses internal state on real events and targets with null prototypes", () => {
  const target = new EventTarget();
  const event = new Event("x", { cancelable: true });
  const observations: unknown[][] = [];
  const record = (event: Event): void => {
    Event.prototype.preventDefault.call(event);
    observations.push([
      eventAttribute(event, "currentTarget"),
      eventAttribute(event, "eventPhase"),
      eventAttribute(event, "defaultPrevented"),
    ]);
  };
  target.addEventListener("x", record, { capture: true, passive: true });
  target.addEventListener("x", record);
  Object.setPrototypeOf(event, null);
  Object.setPrototypeOf(target, null);

  assert.equal(EventTarget.prototype.dispatchEvent.call(target, event), false);
  assert.deepEqual(observations, [
    [target, Event.AT_TARGET, false],
    [target, Event.AT_TARGET, true],
  ]);
  assert.equal(eventAttribute(event, "target"), target);
  assert.equal(eventAttribute(event, "currentTarget"), null);
  assert.equal(eventAttribute(event, "eventPhase"), Event.NONE);
  assert.deepEqual(Event.prototype.composedPath.call(event), []);
  assert.equal(EventTarget.prototype.dispatchEvent.call(target, event), false);
  assert.equal(observations.length, 4, "dispatch clears its flag even without a prototype");
});

test("changing an event prototype during dispatch preserves stop flags and cleanup", () => {
  const target = new EventTarget();
  const event = new Event("x");
  const order: string[] = [];
  let nestedError: unknown;
  target.addEventListener("x", () => {
    order.push("capture");
    Object.setPrototypeOf(event, null);
    Event.prototype.stopPropagation.call(event);
    try {
      target.dispatchEvent(event);
    } catch (error) {
      nestedError = error;
    }
  }, { capture: true, once: true });
  target.addEventListener("x", () => { order.push("later capture"); }, true);
  target.addEventListener("x", () => { order.push("bubble"); });

  assert.equal(target.dispatchEvent(event), true);
  assert.equal((nestedError as { name?: string })?.name, "InvalidStateError");
  assert.deepEqual(order, ["capture", "later capture"]);
  assert.equal(eventAttribute(event, "cancelBubble"), false);
  order.length = 0;
  assert.equal(target.dispatchEvent(event), true);
  assert.deepEqual(order, ["later capture", "bubble"]);
});

// https://dom.spec.whatwg.org/#concept-event-initialize
test("initEvent initializes internal state after the prototype is removed", () => {
  const event = new Event("old", { cancelable: true });
  event.preventDefault();
  event.stopImmediatePropagation();
  Object.setPrototypeOf(event, null);

  Event.prototype.initEvent.call(event, "new", true, false);
  assert.equal(eventAttribute(event, "type"), "new");
  assert.equal(eventAttribute(event, "bubbles"), true);
  assert.equal(eventAttribute(event, "cancelable"), false);
  assert.equal(eventAttribute(event, "defaultPrevented"), false);
  assert.equal(eventAttribute(event, "cancelBubble"), false);
});

test("initCustomEvent initializes both interfaces after the prototype is removed", () => {
  const event = new CustomEvent("old", { detail: "old", cancelable: true });
  event.preventDefault();
  Object.setPrototypeOf(event, null);

  CustomEvent.prototype.initCustomEvent.call(event, "new", true, false, "new detail");
  const detail = Object.getOwnPropertyDescriptor(CustomEvent.prototype, "detail")?.get;
  assert.ok(detail !== undefined);
  assert.equal(detail.call(event), "new detail");
  assert.equal(eventAttribute(event, "type"), "new");
  assert.equal(eventAttribute(event, "bubbles"), true);
  assert.equal(eventAttribute(event, "cancelable"), false);
  assert.equal(eventAttribute(event, "defaultPrevented"), false);
});

// DOM inner invoke reports callback exceptions while continuing dispatch.
// https://dom.spec.whatwg.org/#concept-event-inner-invoke
test("bare EventTarget reports listener errors through the installed scheduler", (t) => {
  const reported: unknown[] = [];
  installEventClock(t, () => 0, (error) => { reported.push(error); });
  const failure = new Error("listener failure");
  const target = new EventTarget();
  const order: string[] = [];
  target.addEventListener("x", () => {
    order.push("throwing capture");
    throw failure;
  }, true);
  target.addEventListener("x", () => { order.push("following capture"); }, true);
  target.addEventListener("x", () => { order.push("bubble"); });

  let result: boolean | undefined;
  assert.doesNotThrow(() => { result = target.dispatchEvent(new Event("x")); });
  assert.equal(result, true);
  assert.deepEqual(reported, [failure]);
  assert.deepEqual(order, ["throwing capture", "following capture", "bubble"]);
});

test("ordinary AbortSignal reports listener errors through the installed scheduler", (t) => {
  const reported: unknown[] = [];
  installEventClock(t, () => 0, (error) => { reported.push(error); });
  const controller = new AbortController();
  const failure = new Error("abort listener failure");
  let followingCalls = 0;
  controller.signal.addEventListener("abort", () => { throw failure; });
  controller.signal.addEventListener("abort", () => { followingCalls++; });

  assert.doesNotThrow(() => controller.abort());
  assert.deepEqual(reported, [failure]);
  assert.equal(followingCalls, 1);
});

test("an explicitly bound event reporter takes precedence over the installed scheduler", (t) => {
  const providerErrors: unknown[] = [];
  const boundErrors: unknown[] = [];
  installEventClock(t, () => 0, (error) => { providerErrors.push(error); });
  class BoundReporterTarget extends EventTarget {
    constructor(reporter: (error: unknown) => void) {
      super();
      this[eventTargetSetErrorReporter](reporter);
    }
  }
  const target = new BoundReporterTarget((error) => { boundErrors.push(error); });
  const failure = new Error("bound listener failure");
  let followingCalls = 0;
  target.addEventListener("x", () => { throw failure; });
  target.addEventListener("x", () => { followingCalls++; });

  assert.doesNotThrow(() => target.dispatchEvent(new Event("x")));
  assert.deepEqual(boundErrors, [failure]);
  assert.deepEqual(providerErrors, []);
  assert.equal(followingCalls, 1);
});
