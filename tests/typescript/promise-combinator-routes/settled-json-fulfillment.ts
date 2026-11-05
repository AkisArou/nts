/*---
description: "A fulfilled record serializes status before value. Route: static field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// A fulfilled record serializes status before value. Route: static field. Node prints settled-json-fulfillment:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [5];
  class Owner { static xs: Iterable<Item>; } Owner.xs = inputs; const routed = Owner.xs;
  const joined = Promise.allSettled(routed);
  const value = await joined;
  assert.sameValue(JSON.stringify(value), '[{"status":"fulfilled","value":5}]');
  console.log("settled-json-fulfillment:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
