/*---
description: "Any ignores resolve after an earlier thenable rejection. Route: private class field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// Any ignores resolve after an earlier thenable rejection. Route: private class field. Node prints turns-any-reject-resolve:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const reason = new RangeError("reason");
  const thenable: Thenable = { then(resolve, reject): void { reject(reason); resolve(7); } };
  const inputs: Iterable<Item> = [thenable];
  class Store { #xs: Iterable<Item>; constructor(xs: Iterable<Item>) { this.#xs = xs; } get(): Iterable<Item> { return this.#xs; } } const routed = new Store(inputs).get();
  const joined = Promise.any(routed);
  let caught: unknown; try { await joined; } catch (error: unknown) { caught = error; }
  if (!(caught instanceof AggregateError)) throw new Error("expected AggregateError");
  assert.compareArray(caught.errors, [reason]);
  console.log("turns-any-reject-resolve:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
