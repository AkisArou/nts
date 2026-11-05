/*---
description: "An early fulfillment wins over a later handled rejection. Route: static class field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// An early fulfillment wins over a later handled rejection. Route: static class field. Node prints race-fulfill-before-reject:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function later(value: Value, n: number): Promise<Value> { let job = Promise.resolve(); for (let i = 0; i < n; i++) job = job.then(() => undefined); return job.then(() => value); }
function fail(reason: unknown, n: number): Promise<Value> { let job = Promise.resolve(); for (let i = 0; i < n; i++) job = job.then(() => undefined); return job.then(() => { throw reason; }); }
async function main(): Promise<void> {
  const reason = { id: 2 };
  const inputs: Iterable<Item> = [later(8, 1), fail(reason, 4)];
  class Owner { static xs: Iterable<Item>; } Owner.xs = inputs; const routed = Owner.xs;
  const joined = Promise.race(routed);
  const value = await joined;
  assert.sameValue(value, 8);
  console.log("race-fulfill-before-reject:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
