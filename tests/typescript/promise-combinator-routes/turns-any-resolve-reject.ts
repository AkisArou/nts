/*---
description: "Any ignores reject after thenable resolve. Route: private class field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// Any ignores reject after thenable resolve. Route: private class field. Node prints turns-any-resolve-reject:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const reason = new RangeError("reason");
  const thenable: Thenable = { then(resolve, reject): void { resolve(7); reject(reason); } };
  const inputs: Iterable<Item> = [thenable];
  class Store { #xs: Iterable<Item>; constructor(xs: Iterable<Item>) { this.#xs = xs; } get(): Iterable<Item> { return this.#xs; } } const routed = new Store(inputs).get();
  const joined = Promise.any(routed);
  const value = await joined;
  assert.sameValue(value, 7);
  console.log("turns-any-resolve-reject:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
