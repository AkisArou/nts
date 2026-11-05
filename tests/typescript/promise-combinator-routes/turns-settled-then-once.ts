/*---
description: "AllSettled calls an adopted thenable's then exactly once. Route: constrained generic helper"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// AllSettled calls an adopted thenable's then exactly once. Route: constrained generic helper. Node prints turns-settled-then-once:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  let calls = 0; const thenable: Thenable = { then(resolve, reject): void { calls++; resolve(7); } };
  const inputs: Iterable<Item> = [thenable];
  function forward<T extends Item>(xs: Iterable<T>): Iterable<T> { return xs; } const routed = forward<Item>(inputs);
  const joined = Promise.allSettled(routed);
  await joined;
  assert.sameValue(calls, 1);
  console.log("turns-settled-then-once:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
