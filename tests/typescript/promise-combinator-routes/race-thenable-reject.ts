/*---
description: "A sole rejecting thenable supplies its exact rejection reason. Route: generic forwarding helper"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// A sole rejecting thenable supplies its exact rejection reason. Route: generic forwarding helper. Node prints race-thenable-reject:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const reason = { id: 6 }; const thenable: Thenable = { then(resolve, reject): void { reject(reason); } };
  const inputs: Iterable<Item> = [thenable];
  function take<T extends Item>(xs: Iterable<T>): Iterable<T> { return xs; } const routed = take<Item>(inputs);
  const joined = Promise.race(routed);
  let caught: unknown; try { await joined; } catch (error: unknown) { caught = error; }
  assert.sameValue(caught, reason);
  console.log("race-thenable-reject:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
