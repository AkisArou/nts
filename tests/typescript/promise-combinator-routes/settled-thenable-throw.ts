/*---
description: "Throwing before thenable settlement records the rejection. Route: generic helper"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// Throwing before thenable settlement records the rejection. Route: generic helper. Node prints settled-thenable-throw:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const reason = { id: 8 }; const input: Thenable = { then(resolve, reject): void { throw reason; } };
  const inputs: Iterable<Item> = [input];
  function pass<T extends Item>(xs: Iterable<T>): Iterable<T> { return xs; } const routed = pass<Item>(inputs);
  const joined = Promise.allSettled(routed);
  const value = await joined;
  assert.sameValue(value[0].status, "rejected"); if (value[0].status === "rejected") assert.sameValue(value[0].reason, reason);
  console.log("settled-thenable-throw:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
