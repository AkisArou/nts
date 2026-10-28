// DOM abort algorithms and Web IDL controls that the pinned WPT files do not cover.
// WPT is kept unedited; these checks exercise the missing edge cases directly.
import assert from "node:assert/strict";
import test from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { AbortController, AbortSignal } from "../src/core/abort.ts";

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
