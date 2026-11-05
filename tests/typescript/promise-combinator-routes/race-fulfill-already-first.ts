/*---
description: "An already fulfilled first input wins over a rejected second. Route: generic forwarding helper"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// An already fulfilled first input wins over a rejected second. Route: generic forwarding helper. Node prints race-fulfill-already-first:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const reason = { id: 4 };
  const inputs: Iterable<Item> = [Promise.resolve(8), Promise.reject(reason)];
  function take<T extends Item>(xs: Iterable<T>): Iterable<T> { return xs; } const routed = take<Item>(inputs);
  const joined = Promise.race(routed);
  const value = await joined;
  assert.sameValue(value, 8);
  console.log("race-fulfill-already-first:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
