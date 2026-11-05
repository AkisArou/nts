/*---
description: "AllSettled converts a thenable throw before settlement into a rejected record. Route: captured binding"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// AllSettled converts a thenable throw before settlement into a rejected record. Route: captured binding. Node prints turns-settled-throw-before:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const reason = new RangeError("reason");
  const thenable: Thenable = { then(resolve, reject): void { throw reason; } };
  const inputs: Iterable<Item> = [thenable];
  let captured: Iterable<Item> = inputs; const read = (): Iterable<Item> => captured; const routed = read();
  const joined = Promise.allSettled(routed);
  const value = await joined;
  assert.sameValue(value.length, 1); assert.sameValue(value[0].status, "rejected");
  if (value[0].status === "rejected") assert.sameValue(value[0].reason, reason);
  console.log("turns-settled-throw-before:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
