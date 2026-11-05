/*---
description: "A first input wins when it settles earlier. Route: captured closure"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// A first input wins when it settles earlier. Route: captured closure. Node prints race-delayed-fast-first:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function later(value: Value, n: number): Promise<Value> { let job = Promise.resolve(); for (let i = 0; i < n; i++) job = job.then(() => undefined); return job.then(() => value); }
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [later("fast", 1), later("slow", 4)];
  let retained: Iterable<Item> = inputs; const reader = (): Iterable<Item> => retained; const routed = reader();
  const joined = Promise.race(routed);
  const value = await joined;
  assert.sameValue(value, "fast");
  console.log("race-delayed-fast-first:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
