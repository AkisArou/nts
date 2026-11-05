/*---
description: "AllSettled ignores a second thenable reject after the first. Route: constrained generic helper"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// AllSettled ignores a second thenable reject after the first. Route: constrained generic helper. Node prints turns-settled-double-reject:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const reason = new RangeError("reason");
  const thenable: Thenable = { then(resolve, reject): void { reject(reason); reject(new Error("late")); } };
  const inputs: Iterable<Item> = [thenable];
  function forward<T extends Item>(xs: Iterable<T>): Iterable<T> { return xs; } const routed = forward<Item>(inputs);
  const joined = Promise.allSettled(routed);
  const value = await joined;
  assert.sameValue(value.length, 1); assert.sameValue(value[0].status, "rejected");
  if (value[0].status === "rejected") assert.sameValue(value[0].reason, reason);
  console.log("turns-settled-double-reject:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
