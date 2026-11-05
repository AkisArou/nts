/*---
description: "A fulfilled record has value but no reason. Route: generic helper"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// A fulfilled record has value but no reason. Route: generic helper. Node prints settled-single-fulfilled:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [8];
  function pass<T extends Item>(xs: Iterable<T>): Iterable<T> { return xs; } const routed = pass<Item>(inputs);
  const joined = Promise.allSettled(routed);
  const value = await joined;
  assert.sameValue(value[0].status, "fulfilled"); assert.sameValue("reason" in value[0], false); if (value[0].status === "fulfilled") assert.sameValue(value[0].value, 8);
  console.log("settled-single-fulfilled:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
