/*---
description: "The winning fulfilled object keeps its identity. Route: private class field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// The winning fulfilled object keeps its identity. Route: private class field. Node prints race-object-identity:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const obj = { id: 5 };
  const inputs: Iterable<Item> = [Promise.resolve(obj), Promise.resolve({ id: 3 })];
  class Shelf { #xs: Iterable<Item>; constructor(xs: Iterable<Item>) { this.#xs = xs; } get(): Iterable<Item> { return this.#xs; } } const routed = new Shelf(inputs).get();
  const joined = Promise.race(routed);
  const value = await joined;
  assert.sameValue(value, obj);
  console.log("race-object-identity:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
