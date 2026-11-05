/*---
description: "Two calls allocate separate arrays and records. Route: generic helper"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// Two calls allocate separate arrays and records. Route: generic helper. Node prints settled-fresh-arrays:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [7];
  function pass<T extends Item>(xs: Iterable<T>): Iterable<T> { return xs; } const routed = pass<Item>(inputs);
  const joined = Promise.allSettled(routed);
  const value = await joined;
  const second = await Promise.allSettled(routed); assert.sameValue(value === second, false); assert.sameValue(value[0] === second[0], false);
  console.log("settled-fresh-arrays:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
