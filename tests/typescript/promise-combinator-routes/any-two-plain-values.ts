/*---
description: "The earlier position wins between two plain values. Route: captured closure"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// The earlier position wins between two plain values. Route: captured closure. Node prints any-two-plain-values:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = ["first", "second"];
  let captured: Iterable<Item> = inputs; const take = (): Iterable<Item> => captured; const routed = take();
  const result = Promise.any(routed);
  const value = await result;
  assert.sameValue(value, "first");
  console.log("any-two-plain-values:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
