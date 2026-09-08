// @ts-nocheck -- converted from `.mjs` and not yet typed.
//
// This file was JavaScript until the suite moved to running TypeScript source directly,
// and it was never type-checked. The pragma says so out loud rather than leaving the
// `.ts` extension to imply a guarantee that does not hold. Removing it is a per-file
// job: `grep -lc "@ts-nocheck" test/*.ts` is the remaining list.
// A listener whose lifetime is bounded by a caller-supplied resource. Node's
// `util.aborted(signal, resource)` needs this: when the resource is collected the
// wait must stop being answered, so the promise stays pending forever rather than
// resolving on behalf of something that no longer exists.
//
// The seam is internal. It is not an `addEventListener` option and adds no property
// to EventTarget, so nothing here is Web-observable. These are host-level tests of
// the shared algorithm; they are not compiled-provider evidence.
import assert from "node:assert/strict";
import test from "node:test";

import {
  AbortController,
  Event,
  EventTarget,
} from "../../../../runtime/web-platform/src/index.ts";
import {
  addInternalEventListener,
  addWeaklyHeldEventListener,
} from "../../../../runtime/web-platform/src/core/events.ts";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function collectWeakReference(reference) {
  assert.equal(typeof globalThis.gc, "function", "the conformance runner must expose GC");
  for (let attempt = 0; attempt < 100; attempt++) {
    await tick();
    globalThis.gc();
    await tick();
    if (reference.deref() === undefined) return true;
  }
  return false;
}

suite("a weakly held listener runs while its resource is alive", () => {
  const target = new EventTarget();
  const resource = {};
  const seen = [];
  addWeaklyHeldEventListener(target, "abort", (event) => seen.push(event.type), resource);

  target.dispatchEvent(new Event("abort"));
  target.dispatchEvent(new Event("abort"));
  assert.deepEqual(seen, ["abort", "abort"]);

  // `once` still retires the listener after one delivery.
  const onceTarget = new EventTarget();
  const onceSeen = [];
  addWeaklyHeldEventListener(onceTarget, "abort", () => onceSeen.push(1), resource, {
    once: true,
  });
  onceTarget.dispatchEvent(new Event("abort"));
  onceTarget.dispatchEvent(new Event("abort"));
  assert.deepEqual(onceSeen, [1]);

  // The resource is still reachable here, so nothing above depended on collection.
  assert.equal(typeof resource, "object");
});

// The resource lives and dies inside this call, and the callback is supplied from
// outside it, so nothing created alongside the resource closes over it. That mirrors
// `util.aborted(signal, resource)`, where the resolver comes from the caller's
// `Promise.withResolvers()`. A callback that captured the resource itself would keep
// it alive through the listener, which is a property of any strongly held callback
// rather than of this seam.
function registerWeakly(target, callback, once = true) {
  const resource = {};
  addWeaklyHeldEventListener(target, "abort", callback, resource, { once });
  return new WeakRef(resource);
}

suite("a collected resource retires the listener before it can be called", async () => {
  const controller = new AbortController();
  let resolved = false;
  const resolve = () => {
    resolved = true;
  };
  const reference = registerWeakly(controller.signal, resolve);

  assert.equal(
    await collectWeakReference(reference),
    true,
    "a weakly held listener must not keep its resource alive",
  );

  controller.abort();
  await tick();
  assert.equal(resolved, false, "a wait keyed to a collected resource must stay pending");
});

suite("an ordinary listener on the same signal is unaffected by collection", async () => {
  const controller = new AbortController();
  const order = [];
  const weak = () => order.push("weak");
  const reference = registerWeakly(controller.signal, weak);
  controller.signal.addEventListener("abort", () => order.push("strong"), { once: true });

  assert.equal(await collectWeakReference(reference), true);
  controller.abort();
  await tick();
  assert.deepEqual(order, ["strong"], "only the weakly held listener is retired");
});

suite("the weakly held seam is not reachable from the public Web API", () => {
  const target = new EventTarget();
  const seen = [];
  const resource = {};

  // A dictionary member cannot request weak retention: this registers an ordinary
  // strong listener, and the surplus members are ignored.
  target.addEventListener("abort", () => seen.push("ordinary"), {
    once: true,
    weakResource: resource,
    resource,
    weak: resource,
  });
  target.dispatchEvent(new Event("abort"));
  assert.deepEqual(seen, ["ordinary"]);

  // The seam adds no property to EventTarget or its prototype.
  for (const name of ["addWeaklyHeldEventListener", "registerWeaklyHeld", "retireWeaklyHeld"]) {
    assert.equal(name in target, false, `EventTarget must not expose ${name}`);
    assert.equal(
      Object.prototype.hasOwnProperty.call(EventTarget.prototype, name),
      false,
      `EventTarget.prototype must not expose ${name}`,
    );
  }
  // Nothing named for this seam reaches the prototype at all. The list is filtered
  // rather than compared whole because TypeScript `private`/`protected` are erased,
  // so unrelated internal methods are already own properties here; that pre-existing
  // surface question is not this seam's to answer.
  const weakNames = Object.getOwnPropertyNames(EventTarget.prototype).filter((name) =>
    /weak/i.test(name),
  );
  assert.deepEqual(weakNames, []);
});

suite("a weakly held listener follows the public duplicate and removal rules", () => {
  const target = new EventTarget();
  const seen = [];
  const resource = {};
  const callback = () => seen.push(1);

  addWeaklyHeldEventListener(target, "abort", callback, resource);
  // Duplicate registration follows the public (type, callback, capture) rule, so
  // this seam cannot install a copy the public API would have rejected.
  addWeaklyHeldEventListener(target, "abort", callback, resource);
  target.dispatchEvent(new Event("abort"));
  assert.deepEqual(seen, [1], "a duplicate registration must not install a second copy");

  // An ordinary removeEventListener retires it; the caller does not need the seam
  // to take it back off.
  target.removeEventListener("abort", callback);
  target.dispatchEvent(new Event("abort"));
  assert.deepEqual(seen, [1]);
  assert.equal(typeof resource, "object");
});

suite("an internal listener can resist stopImmediatePropagation", () => {
  const target = new EventTarget();
  const order = [];

  // Registration order matters: the resisting listener is registered last, so without
  // the option it would be the one hidden by the stop.
  target.addEventListener("abort", (event) => {
    order.push("script");
    event.stopImmediatePropagation();
  });
  target.addEventListener("abort", () => order.push("later-script"));
  addInternalEventListener(target, "abort", () => order.push("internal"), {
    resistStopPropagation: true,
  });

  target.dispatchEvent(new Event("abort"));
  // The ordinary later listener is silenced; the internal one is not.
  assert.deepEqual(order, ["script", "internal"]);
});

suite("an internal listener without the option is silenced like any other", () => {
  const target = new EventTarget();
  const order = [];
  target.addEventListener("abort", (event) => {
    order.push("script");
    event.stopImmediatePropagation();
  });
  addInternalEventListener(target, "abort", () => order.push("internal"));
  target.dispatchEvent(new Event("abort"));
  assert.deepEqual(order, ["script"], "resisting is opt-in, not what internal means");
});

suite("stopImmediatePropagation is not observable through the public API", () => {
  const target = new EventTarget();
  const order = [];
  // No dictionary member requests resistance: a surplus member is inert, and the
  // listener is silenced exactly as it would be without it.
  target.addEventListener("abort", (event) => {
    order.push("script");
    event.stopImmediatePropagation();
  });
  target.addEventListener("abort", () => order.push("forged"), {
    resistStopPropagation: true,
    kResistStopPropagation: true,
  });
  target.dispatchEvent(new Event("abort"));
  assert.deepEqual(order, ["script"]);
  const resistNames = Object.getOwnPropertyNames(EventTarget.prototype).filter((name) =>
    /resist/i.test(name),
  );
  assert.deepEqual(resistNames, []);
});

suite("resisting and weak holding compose", async () => {
  const controller = new AbortController();
  const order = [];
  controller.signal.addEventListener("abort", (event) => {
    order.push("script");
    event.stopImmediatePropagation();
  });

  // A live resource: the resisting weak listener runs despite the stop.
  const live = {};
  addWeaklyHeldEventListener(controller.signal, "abort", () => order.push("weak"), live, {
    once: true,
    resistStopPropagation: true,
  });

  // A collected resource: resisting does not resurrect a listener whose reason for
  // existing is gone.
  const reference = registerResistingWeakly(controller.signal, () => order.push("dead"));
  assert.equal(await collectWeakReference(reference), true);

  controller.abort();
  await tick();
  assert.deepEqual(order, ["script", "weak"]);
  assert.equal(typeof live, "object");
});

function registerResistingWeakly(target, callback) {
  const resource = {};
  addWeaklyHeldEventListener(target, "abort", callback, resource, {
    once: true,
    resistStopPropagation: true,
  });
  return new WeakRef(resource);
}
