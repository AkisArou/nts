/*---
description: "An empty iterable fulfills with an empty array. Route: captured binding"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// An empty iterable fulfills with an empty array. Route: captured binding. Node prints settled-empty:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [];
  let captured = inputs; const read = (): Iterable<Item> => captured; const routed = read();
  const joined = Promise.allSettled(routed);
  const value = await joined;
  assert.compareArray(value, []); assert.sameValue(value.length, 0);
  console.log("settled-empty:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
