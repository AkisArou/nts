/*---
description: "A sole thenable is adopted once and fulfills race. Route: interface holder"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// A sole thenable is adopted once and fulfills race. Route: interface holder. Node prints race-thenable-alone:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  let calls = 0; const thenable: Thenable = { then(resolve, reject): void { calls++; resolve(9); } };
  const inputs: Iterable<Item> = [thenable];
  interface Holder { xs: Iterable<Item>; } const holder: Holder = { xs: inputs }; const routed = holder.xs;
  const joined = Promise.race(routed);
  const value = await joined;
  assert.sameValue(value, 9); assert.sameValue(calls, 1);
  console.log("race-thenable-alone:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
