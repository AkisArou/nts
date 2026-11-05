/*---
description: "An immediately resolving thenable wins against a delayed promise. Route: private class field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// An immediately resolving thenable wins against a delayed promise. Route: private class field. Node prints any-thenable-first:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function delayed(value: Value, n: number): Promise<Value> { let job = Promise.resolve(); for (let i = 0; i < n; i++) job = job.then(() => undefined); return job.then(() => value); }
async function main(): Promise<void> {
  const thenable: Thenable = { then(resolve, reject): void { resolve(7); } };
  const inputs: Iterable<Item> = [thenable, delayed(8, 3)];
  class Shelf { #xs: Iterable<Item>; constructor(xs: Iterable<Item>) { this.#xs = xs; } read(): Iterable<Item> { return this.#xs; } } const routed = new Shelf(inputs).read();
  const result = Promise.any(routed);
  const value = await result;
  assert.sameValue(value, 7);
  console.log("any-thenable-first:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
