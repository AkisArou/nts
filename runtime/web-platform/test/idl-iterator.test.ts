import assert from "node:assert/strict";
import test from "node:test";

import { Headers, URLSearchParams } from "../src/index.ts";

// WebIDL 3.7.10: an interface with an `iterable<>` declaration has one *iterator prototype
// object*, whose [[Prototype]] is %IteratorPrototype%, carrying `next` as a writable,
// enumerable, configurable data property.
//
// `headers-basic.any.js` asserts exactly this upstream and cannot pass here: it computes
// %IteratorPrototype% from `[][Symbol.iterator]()` inside the vm context, `Array` is not among
// the intrinsics the runner injects, and our objects are built in the host realm. Two different
// %IteratorPrototype%s, so the identity check fails for any implementation. The runner says as
// much where it chooses which `Object` to inject: "the real fix is for the harness and the
// implementation to share a realm".
//
// So the requirement is checked here instead, same-realm, where the identity means something.
// Without it the three upstream failures would be the only record of this rule, and they fail
// whether the implementation is right or wrong -- which is no record at all.

const ITERATOR_PROTOTYPE = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));

const suite = (name: string, fn: () => void): void => {
  void test(name, fn);
};

function checkIteratorProperties(iterator: IterableIterator<unknown>, tag: string): void {
  const prototype = Object.getPrototypeOf(iterator) as object;
  assert.strictEqual(
    Object.getPrototypeOf(prototype),
    ITERATOR_PROTOTYPE,
    "the iterator prototype object must inherit directly from %IteratorPrototype%",
  );
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "next");
  assert.ok(descriptor, "`next` must be an own property of the iterator prototype object");
  assert.strictEqual(descriptor.configurable, true, "configurable");
  assert.strictEqual(descriptor.enumerable, true, "enumerable");
  assert.strictEqual(descriptor.writable, true, "writable");
  assert.strictEqual((prototype as { [Symbol.toStringTag]?: string })[Symbol.toStringTag], tag);
}

suite("Headers iterators have the Web IDL iterator prototype object", () => {
  const headers = new Headers({ b: "2", a: "1" });
  checkIteratorProperties(headers.keys(), "Headers Iterator");
  checkIteratorProperties(headers.values(), "Headers Iterator");
  checkIteratorProperties(headers.entries(), "Headers Iterator");
  checkIteratorProperties(headers[Symbol.iterator](), "Headers Iterator");
});

suite("one prototype object per interface, shared by every iterator it hands out", () => {
  const headers = new Headers({ a: "1" });
  const keys = Object.getPrototypeOf(headers.keys()) as object;
  assert.strictEqual(Object.getPrototypeOf(headers.values()), keys);
  assert.strictEqual(Object.getPrototypeOf(headers.entries()), keys);
  // A second instance shares it too: the prototype belongs to the interface, not the object.
  assert.strictEqual(Object.getPrototypeOf(new Headers({ z: "9" }).keys()), keys);
  // And it is not the one a *different* interface uses.
  assert.notStrictEqual(Object.getPrototypeOf(new URLSearchParams("a=1").keys()), keys);
});

suite("URLSearchParams iterators have the Web IDL iterator prototype object", () => {
  const params = new URLSearchParams("b=2&a=1");
  checkIteratorProperties(params.keys(), "URLSearchParams Iterator");
  checkIteratorProperties(params.values(), "URLSearchParams Iterator");
  checkIteratorProperties(params.entries(), "URLSearchParams Iterator");
  checkIteratorProperties(params[Symbol.iterator](), "URLSearchParams Iterator");
});

suite("the values and their order are what they were", () => {
  const headers = new Headers({ b: "2", a: "1" });
  assert.deepEqual([...headers.keys()], ["a", "b"]);
  assert.deepEqual([...headers.values()], ["1", "2"]);
  assert.deepEqual([...headers.entries()], [
    ["a", "1"],
    ["b", "2"],
  ]);
  const params = new URLSearchParams("b=2&a=1");
  assert.deepEqual([...params.keys()], ["b", "a"]);
  assert.deepEqual([...params.entries()], [
    ["b", "2"],
    ["a", "1"],
  ]);
});

suite("an iterator is drained once and stays done", () => {
  const keys = new Headers({ a: "1" }).keys();
  assert.deepEqual(keys.next(), { value: "a", done: false });
  assert.deepEqual(keys.next(), { value: undefined, done: true });
  assert.deepEqual(keys.next(), { value: undefined, done: true });
});

suite("`next` on something that is not one of these iterators throws", () => {
  const prototype = Object.getPrototypeOf(new Headers({ a: "1" }).keys()) as {
    next: () => unknown;
  };
  assert.throws(() => prototype.next.call({}), TypeError);
  assert.throws(() => prototype.next.call(Object.create(prototype)), TypeError);
});

suite("iteration observes mutation the way it did before", () => {
  // `Headers` re-reads its sorted view each step, so a header added mid-iteration is seen.
  const headers = new Headers({ a: "1" });
  const seen: string[] = [];
  for (const key of headers.keys()) {
    seen.push(key);
    if (key === "a") headers.append("b", "2");
  }
  assert.deepEqual(seen, ["a", "b"]);
});
