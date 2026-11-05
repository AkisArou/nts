/*---
description: "A plain first position wins over a later resolved promise. Route: interface holder"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// A plain first position wins over a later resolved promise. Route: interface holder. Node prints race-plain-before-resolved:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [1, Promise.resolve(2)];
  interface Holder { xs: Iterable<Item>; } const holder: Holder = { xs: inputs }; const routed = holder.xs;
  const joined = Promise.race(routed);
  const value = await joined;
  assert.sameValue(value, 1);
  console.log("race-plain-before-resolved:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
