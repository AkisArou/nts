/*---
description: "All calls an adopted thenable's then exactly once. Route: interface field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// All calls an adopted thenable's then exactly once. Route: interface field. Node prints turns-all-then-once:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  let calls = 0; const thenable: Thenable = { then(resolve, reject): void { calls++; resolve(7); } };
  const inputs: Iterable<Item> = [thenable];
  interface Holder { xs: Iterable<Item>; } const holder: Holder = { xs: inputs }; const routed = holder.xs;
  const joined = Promise.all(routed);
  await joined;
  assert.sameValue(calls, 1);
  console.log("turns-all-then-once:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
