/*---
description: "All ignores a second thenable resolve after the first. Route: interface field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// All ignores a second thenable resolve after the first. Route: interface field. Node prints turns-all-double-resolve:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const reason = new RangeError("reason");
  const thenable: Thenable = { then(resolve, reject): void { resolve(7); resolve(9); } };
  const inputs: Iterable<Item> = [thenable];
  interface Holder { xs: Iterable<Item>; } const holder: Holder = { xs: inputs }; const routed = holder.xs;
  const joined = Promise.all(routed);
  const value = await joined;
  assert.compareArray(value, [7]);
  console.log("turns-all-double-resolve:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
