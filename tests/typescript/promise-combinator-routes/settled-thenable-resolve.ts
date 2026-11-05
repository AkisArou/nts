/*---
description: "A typed thenable is adopted once into a fulfilled record. Route: static field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// A typed thenable is adopted once into a fulfilled record. Route: static field. Node prints settled-thenable-resolve:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  let calls = 0; const input: Thenable = { then(resolve, reject): void { calls++; resolve(9); } };
  const inputs: Iterable<Item> = [input];
  class Owner { static xs: Iterable<Item>; } Owner.xs = inputs; const routed = Owner.xs;
  const joined = Promise.allSettled(routed);
  const value = await joined;
  assert.sameValue(calls, 1); assert.sameValue(value[0].status, "fulfilled"); if (value[0].status === "fulfilled") assert.sameValue(value[0].value, 9);
  console.log("settled-thenable-resolve:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
