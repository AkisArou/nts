/*---
description: "Any fulfills with undefined from a hole in a numeric array. Route: constrained generic helper"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// Any fulfills with undefined from a hole in a numeric array. Route: constrained generic helper. Node prints any-sparse-fulfillment:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = new Array<number>(2);
  function pass<T extends Item>(xs: Iterable<T>): Iterable<T> { return xs; } const routed = pass<Item>(inputs);
  const result = Promise.any(routed);
  const value = await result;
  assert.sameValue(value, undefined);
  console.log("any-sparse-fulfillment:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
