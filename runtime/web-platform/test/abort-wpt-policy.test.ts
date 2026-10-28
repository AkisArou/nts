// DOM abort algorithms and Web IDL controls that the pinned WPT files do not cover.
// WPT is kept unedited; these checks exercise the missing edge cases directly.
import assert from "node:assert/strict";
import test from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { AbortController, AbortSignal } from "../src/core/abort.ts";
import { abortSignalBrand, abortSignalSubscribe } from "../src/core/abort-brand.ts";
import { Event, EventTarget } from "../src/core/events.ts";

const runtime = createHostNodeWebPlatform();
test.after(() => runtime.close());

/** Deliberately invalid JavaScript inputs exercise the Web IDL boundary. */
function anySignal(value: unknown): AbortSignal {
  return AbortSignal.any(value as Iterable<AbortSignal>);
}

// https://webidl.spec.whatwg.org/#es-sequence
// https://webidl.spec.whatwg.org/#create-sequence-from-iterable
test("AbortSignal.any requires an object sequence, including for empty input", () => {
  assert.throws(() => anySignal(""), TypeError);
  assert.equal(anySignal(new String("")).aborted, false);
  for (const input of [undefined, null, false, 0, Symbol("signals")]) {
    assert.throws(() => anySignal(input), TypeError);
  }
});

test("AbortSignal.any does not close an iterator after element conversion fails", () => {
  let closed = false;
  const inputs = {
    *[Symbol.iterator]() {
      try {
        yield {};
      } finally {
        closed = true;
      }
    },
  };
  assert.throws(() => anySignal(inputs), TypeError);
  assert.equal(closed, false);
});

test("AbortSignal.any captures next once and preserves its iterator receiver", () => {
  const controller = new AbortController();
  let reads = 0;
  let calls = 0;
  const iterator = {
    get next() {
      reads++;
      return function (this: object): IteratorResult<AbortSignal> {
        assert.equal(this, iterator);
        calls++;
        return calls === 1
          ? { done: false, value: controller.signal }
          : { done: true, value: undefined };
      };
    },
  };
  const inputs = {
    [Symbol.iterator]() {
      assert.equal(this, inputs);
      return iterator;
    },
  };
  const combined = anySignal(inputs);
  assert.equal(reads, 1);
  assert.equal(calls, 2);
  controller.abort("reason");
  assert.equal(combined.reason, "reason");
});

test("AbortSignal.any rejects primitive iterator objects and iterator results", () => {
  assert.throws(() => anySignal({ [Symbol.iterator]: () => 1 }), TypeError);
  assert.throws(
    () => anySignal({ [Symbol.iterator]: () => ({ next: () => null }) }),
    TypeError,
  );
  assert.throws(
    () => anySignal({ [Symbol.iterator]: () => ({ next: { call: () => ({ done: true }) } }) }),
    TypeError,
  );
});

// https://dom.spec.whatwg.org/#create-a-dependent-abort-signal
// https://webidl.spec.whatwg.org/#es-interface
// https://webidl.spec.whatwg.org/#es-attributes
// https://webidl.spec.whatwg.org/#es-operations
test("AbortSignal.any reads internal state without invoking public getters", () => {
  const controller = new AbortController();
  const prototype = {
    get aborted(): boolean {
      throw new Error("public aborted getter was invoked");
    },
    get reason(): unknown {
      throw new Error("public reason getter was invoked");
    },
  };
  Object.setPrototypeOf(prototype, AbortSignal.prototype);
  Object.setPrototypeOf(controller.signal, prototype);
  const combined = AbortSignal.any([controller.signal]);
  assert.equal(combined.aborted, false);
  controller.abort("actual reason");
  assert.equal(combined.aborted, true);
  assert.equal(combined.reason, "actual reason");
});

test("AbortSignal.any uses an already-aborted source's internal reason", () => {
  const reason = {};
  const signal = AbortSignal.abort(reason);
  const prototype = {
    get aborted(): boolean { return false; },
    get reason(): unknown { return "forged reason"; },
  };
  Object.setPrototypeOf(prototype, AbortSignal.prototype);
  Object.setPrototypeOf(signal, prototype);
  const combined = AbortSignal.any([signal]);
  assert.equal(combined.aborted, true);
  assert.equal(combined.reason, reason);
});

test("AbortSignal.any rejects an object that only inherits the interface prototype", () => {
  const forged = Object.create(AbortSignal.prototype) as object;
  Object.assign(forged, { isAborted: true, abortReason: "forged reason" });
  assert.throws(() => anySignal([forged]), TypeError);
});

test("Abort state and the controller's signal cannot be replaced by expandos", () => {
  const controller = new AbortController();
  const signal = controller.signal;
  const other = new AbortController();
  Object.assign(signal, { isAborted: true, abortReason: "forged reason" });
  Object.assign(controller, { controllerSignal: other.signal });
  assert.equal(controller.signal, signal);
  assert.equal(signal.aborted, false);
  assert.equal(signal.reason, undefined);
  controller.abort("actual reason");
  assert.equal(signal.reason, "actual reason");
  assert.equal(other.signal.aborted, false);
});

test("Abort interface getters and operations reject an unbranded receiver", () => {
  for (const member of ["aborted", "reason", "onabort"]) {
    const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, member)?.get;
    assert.equal(typeof getter, "function");
    assert.throws(() => getter?.call({}), TypeError);
  }
  const signalGetter = Object.getOwnPropertyDescriptor(AbortController.prototype, "signal")?.get;
  assert.throws(() => signalGetter?.call({}), TypeError);
  assert.throws(() => AbortSignal.prototype.throwIfAborted.call({} as AbortSignal), TypeError);
  assert.throws(() => AbortController.prototype.abort.call({} as AbortController), TypeError);
});

test("AbortSignal.any accepts a branded signal even after its prototype changes", () => {
  const reason = {};
  const signal = AbortSignal.abort(reason);
  Object.setPrototypeOf(signal, null);
  const combined = AbortSignal.any([signal]);
  assert.equal(combined.aborted, true);
  assert.equal(combined.reason, reason);
});

const tick = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

async function collected(reference: WeakRef<object>): Promise<boolean> {
  assert.equal(typeof globalThis.gc, "function", "run this suite with --expose-gc");
  for (let attempt = 0; attempt < 100; attempt++) {
    await tick();
    globalThis.gc?.();
    await tick();
    if (reference.deref() === undefined) return true;
  }
  return false;
}

function observedComposite(sources: AbortSignal[], listener: () => void): WeakRef<AbortSignal> {
  const signal = AbortSignal.any(sources);
  signal.addEventListener("abort", listener);
  return new WeakRef(signal);
}

// https://dom.spec.whatwg.org/#abortsignal-garbage-collection
// Aborted signals no longer need the strong retention required for active dependents.
test("an aborted composite is released by sources that have not aborted", async () => {
  const first = new AbortController();
  const second = new AbortController();
  const reference = observedComposite([first.signal, second.signal], () => {});
  first.abort();
  assert.equal(await collected(reference), true);
  // Keep both source objects live through collection, particularly the non-aborted source.
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
});

test("an active source retains an observed composite until it aborts", async () => {
  const controller = new AbortController();
  let calls = 0;
  const reference = observedComposite([controller.signal], () => calls++);
  await tick();
  globalThis.gc?.();
  await tick();
  assert.notEqual(reference.deref(), undefined);
  controller.abort();
  assert.equal(calls, 1);
});

// https://dom.spec.whatwg.org/#create-a-dependent-abort-signal
// A dependent with no source signals must not become a source during composition.
test("an empty dependent signal does not retain later observed composites", async () => {
  const empty = AbortSignal.any([]);
  const reference = observedComposite([empty], () => {});
  assert.equal(await collected(reference), true);
  assert.equal(empty.aborted, false);
});

// https://webidl.spec.whatwg.org/#es-operations
// Optional-only argument lists give operation functions a length of zero.
test("abort operations expose the Web IDL required-argument arity", () => {
  assert.equal(AbortSignal.abort.length, 0);
  assert.equal(AbortController.prototype.abort.length, 0);
  assert.equal(AbortSignal.any.length, 1);
  assert.equal(AbortSignal.timeout.length, 1);
  const reason = {};
  assert.equal(AbortSignal.abort(reason).reason, reason);
  const controller = new AbortController();
  controller.abort(reason);
  assert.equal(controller.signal.reason, reason);
});

// Web IDL uses the abstract Call operation for iterator.next, not a property
// named call on the supplied function: https://webidl.spec.whatwg.org/#create-sequence-from-iterable
for (const accessor of [false, true]) {
  test(`AbortSignal.any ignores an iterator next function's ${accessor ? "call getter" : "own call property"}`, { skip: "prototype patching and function call-property spoofing are outside the nts program contract" }, () => {
    const controller = new AbortController();
    let calls = 0;
    function next(this: object): IteratorResult<AbortSignal> {
      assert.equal(this, iterator);
      calls++;
      return calls === 1
        ? { done: false, value: controller.signal }
        : { done: true, value: undefined };
    }
    if (accessor) {
      Object.setPrototypeOf(next, {
        get call(): unknown {
          throw new Error("The iterator next.call getter must not be read");
        },
      });
    } else {
      Object.assign(next, {
        call(): never {
          throw new Error("The iterator next.call property must not be invoked");
        },
      });
    }
    const iterator = { next };
    const combined = anySignal({ [Symbol.iterator]: () => iterator });
    assert.equal(calls, 2);
    controller.abort("actual reason");
    assert.equal(combined.reason, "actual reason");
  });
}

// Interface conversion tests identity, not script-visible properties. The add an
// event listener algorithm then reads abort state and installs an internal step.
// https://webidl.spec.whatwg.org/#es-interface
// https://webidl.spec.whatwg.org/#es-dictionary
// https://dom.spec.whatwg.org/#add-an-event-listener
test("EventTarget cancellation accepts a real signal and an omitted signal", () => {
  const controller = new AbortController();
  const target = new EventTarget();
  let withSignal = 0;
  let withoutSignal = 0;
  target.addEventListener("test", () => withSignal++, { signal: controller.signal });
  target.addEventListener("test", () => withoutSignal++, { signal: undefined });
  target.dispatchEvent(new Event("test"));
  controller.abort();
  target.dispatchEvent(new Event("test"));
  assert.equal(withSignal, 1);
  assert.equal(withoutSignal, 2);
});

test("EventTarget rejects structural and prototype-only signal forgeries", () => {
  const target = new EventTarget();
  const structural = {
    [abortSignalBrand]: true,
    aborted: false,
    [abortSignalSubscribe]: () => () => {},
  };
  const prototypeOnly = Object.create(AbortSignal.prototype) as object;
  for (const value of [null, false, 0, "signal", {}, prototypeOnly, structural]) {
    assert.throws(
      () => target.addEventListener("test", () => {}, { signal: value as AbortSignal }),
      TypeError,
    );
  }
});

test("EventTarget converts signal even for a null callback", () => {
  const target = new EventTarget();
  const signal = {
    [abortSignalBrand]: true,
    aborted: false,
    [abortSignalSubscribe]: () => () => {},
  };
  assert.throws(
    () => target.addEventListener("test", null, { signal: signal as unknown as AbortSignal }),
    TypeError,
  );
});

test("EventTarget does not read properties while rejecting an invalid signal", () => {
  const target = new EventTarget();
  const signal = {
    get [abortSignalBrand](): true {
      throw new Error("the supplied brand property must not be read");
    },
    get aborted(): boolean {
      throw new Error("the supplied aborted property must not be read");
    },
    get [abortSignalSubscribe](): unknown {
      throw new Error("the supplied subscription property must not be read");
    },
  };
  assert.throws(
    () => target.addEventListener("test", () => {}, { signal: signal as AbortSignal }),
    TypeError,
  );
});

test("EventTarget ignores an active signal's public aborted getter", () => {
  const controller = new AbortController();
  const target = new EventTarget();
  const prototype = {
    get aborted(): boolean {
      throw new Error("the public aborted getter must not be read");
    },
  };
  Object.setPrototypeOf(prototype, AbortSignal.prototype);
  Object.setPrototypeOf(controller.signal, prototype);
  let calls = 0;
  target.addEventListener("test", () => calls++, { signal: controller.signal });
  target.dispatchEvent(new Event("test"));
  controller.abort();
  target.dispatchEvent(new Event("test"));
  assert.equal(calls, 1);
});

test("EventTarget uses an already-aborted signal's internal state", () => {
  const signal = AbortSignal.abort();
  const target = new EventTarget();
  let reads = 0;
  const prototype = {
    get aborted(): boolean {
      reads++;
      return false;
    },
  };
  Object.setPrototypeOf(prototype, AbortSignal.prototype);
  Object.setPrototypeOf(signal, prototype);
  let calls = 0;
  target.addEventListener("test", () => calls++, { signal });
  target.dispatchEvent(new Event("test"));
  assert.equal(reads, 0);
  assert.equal(calls, 0);
});

test("EventTarget ignores a genuine signal's shadowed symbol brand", () => {
  const controller = new AbortController();
  Object.assign(controller.signal, { [abortSignalBrand]: false });
  const target = new EventTarget();
  let calls = 0;
  target.addEventListener("test", () => calls++, { signal: controller.signal });
  target.dispatchEvent(new Event("test"));
  controller.abort();
  target.dispatchEvent(new Event("test"));
  assert.equal(calls, 1);
});

for (const accessor of [false, true]) {
  test(`EventTarget ignores a signal's subscription ${accessor ? "getter" : "method override"}`, () => {
    const controller = new AbortController();
    const target = new EventTarget();
    if (accessor) {
      const prototype = {
        get [abortSignalSubscribe](): unknown {
          throw new Error("the subscription getter must not be read");
        },
      };
      Object.setPrototypeOf(prototype, AbortSignal.prototype);
      Object.setPrototypeOf(controller.signal, prototype);
    } else {
      Object.assign(controller.signal, {
        [abortSignalSubscribe](): never {
          throw new Error("the subscription override must not be invoked");
        },
      });
    }
    let calls = 0;
    target.addEventListener("test", () => calls++, { signal: controller.signal });
    target.dispatchEvent(new Event("test"));
    controller.abort();
    target.dispatchEvent(new Event("test"));
    assert.equal(calls, 1);
  });
}

test("EventTarget accepts and unsubscribes a signal after its prototype is removed", () => {
  const controller = new AbortController();
  const signal = controller.signal;
  const target = new EventTarget();
  let calls = 0;
  const listener = (): void => { calls++; };
  Object.setPrototypeOf(signal, null);
  target.addEventListener("test", listener, { signal });
  target.dispatchEvent(new Event("test"));
  target.removeEventListener("test", listener);
  // Controller dispatch uses separate internal operations; restore their prototype
  // after checking that registration and unsubscription use only private state.
  Object.setPrototypeOf(signal, AbortSignal.prototype);
  controller.abort();
  target.dispatchEvent(new Event("test"));
  assert.equal(calls, 1);
});
