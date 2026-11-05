/*---
description: "An earlier resolved promise wins before a later plain value. Route: generic forwarding helper"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// An earlier resolved promise wins before a later plain value. Route: generic forwarding helper. Node prints race-resolved-before-plain:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [Promise.resolve(2), 1];
  function take<T extends Item>(xs: Iterable<T>): Iterable<T> { return xs; } const routed = take<Item>(inputs);
  const joined = Promise.race(routed);
  const value = await joined;
  assert.sameValue(value, 2);
  console.log("race-resolved-before-plain:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
