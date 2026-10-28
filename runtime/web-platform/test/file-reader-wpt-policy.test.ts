// File API source-policy controls. Node 24.20.0 has no FileReader or ProgressEvent;
// these new surfaces are checked against their specifications, not a host wrapper.
import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import type { TestContext } from "node:test";
import { createHostNodePrimitives, createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { Event } from "../src/core/events.ts";
import { ProgressEvent } from "../src/core/progress-event.ts";
import type { ProgressEventInit } from "../src/core/progress-event.ts";
import { installWebPlatformRuntime, VirtualScheduler, WebPlatformRuntime } from "../src/provider.ts";

const hostRuntime = createHostNodeWebPlatform();
after(() => hostRuntime.close());

function virtualRuntime(t: TestContext): VirtualScheduler {
  const scheduler = new VirtualScheduler();
  const runtime = new WebPlatformRuntime({
    ...createHostNodePrimitives(),
    scheduler,
    monotonicMilliseconds: () => scheduler.now,
  });
  installWebPlatformRuntime(runtime);
  t.after(() => {
    runtime.close();
    installWebPlatformRuntime(hostRuntime);
  });
  return scheduler;
}

// https://xhr.spec.whatwg.org/#interface-progressevent
test("ProgressEvent preserves Event options and finite-double progress values", () => {
  const defaults = new ProgressEvent("progress");
  assert.ok(defaults instanceof Event);
  assert.equal(defaults.lengthComputable, false);
  assert.equal(defaults.loaded, 0);
  assert.equal(defaults.total, 0);
  assert.equal(defaults.isTrusted, false);
  const event = new ProgressEvent("progress", {
    bubbles: true, cancelable: true, composed: true,
    lengthComputable: true, loaded: -0.5, total: -0,
  });
  assert.equal(event.bubbles, true);
  assert.equal(event.cancelable, true);
  assert.equal(event.composed, true);
  assert.equal(event.lengthComputable, true);
  assert.equal(event.loaded, -0.5);
  assert.ok(Object.is(event.total, -0));
});

test("ProgressEvent converts inherited dictionary members before its own and captures time afterward", (t) => {
  const scheduler = virtualRuntime(t);
  const order: string[] = [];
  const init = {
    get bubbles() { order.push("bubbles"); return false; },
    get cancelable() { order.push("cancelable"); return false; },
    get composed() { order.push("composed"); return false; },
    get lengthComputable() { order.push("lengthComputable"); return true; },
    get loaded() {
      order.push("loaded");
      return { valueOf() { order.push("loaded valueOf"); scheduler.advance(10); return 1.5; } };
    },
    get total() { order.push("total"); return 2.5; },
  } as unknown as ProgressEventInit;
  const event = new ProgressEvent("progress", init);
  assert.deepEqual(order, ["bubbles", "cancelable", "composed", "lengthComputable", "loaded", "loaded valueOf", "total"]);
  assert.equal(event.timeStamp, 10);
  assert.equal(event.loaded, 1.5);
  assert.equal(event.total, 2.5);
});

test("ProgressEvent rejects non-finite doubles, invalid dictionaries, and missing type", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => new ProgressEvent("progress", { loaded: value }), TypeError);
    assert.throws(() => new ProgressEvent("progress", { total: value }), TypeError);
  }
  assert.throws(() => new ProgressEvent("progress", 1 as unknown as ProgressEventInit), TypeError);
  // @ts-expect-error Web IDL required-argument control.
  assert.throws(() => new ProgressEvent(), TypeError);
  assert.throws(() => new ProgressEvent("progress", { loaded: 1n as unknown as number }), TypeError);
});
