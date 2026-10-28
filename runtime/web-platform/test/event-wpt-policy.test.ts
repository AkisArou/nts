import assert from "node:assert/strict";
import test from "node:test";

import {
  Event,
  EventTarget,
  addInternalEventListener,
} from "../src/core/events.ts";

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
