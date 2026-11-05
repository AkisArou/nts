/*---
description: "An already rejected first member does not outrank an already fulfilled second member. Route: private class field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// An already rejected first member does not outrank an already fulfilled second member. Route: private class field. Node prints any-already-rejected-then-fulfilled:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const reason = new Error("no");
  const inputs: Iterable<Item> = [Promise.reject(reason), Promise.resolve(8)];
  class Shelf { #xs: Iterable<Item>; constructor(xs: Iterable<Item>) { this.#xs = xs; } read(): Iterable<Item> { return this.#xs; } } const routed = new Shelf(inputs).read();
  const result = Promise.any(routed);
  const value = await result;
  assert.sameValue(value, 8);
  console.log("any-already-rejected-then-fulfilled:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
