/*---
description: "All calls an adopted thenable's then exactly once. Route: interface field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// All calls an adopted thenable's then exactly once. Route: interface field. Node prints turns-all-then-once:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function localAll<T>(xs: Iterable<T>): Promise<Awaited<T>[]> {
  return new Promise((resolve, reject) => {
    const values: Awaited<T>[] = []; let left = 1, index = 0;
    for (const input of xs) {
      const i = index++; left++;
      Promise.resolve(input).then(value => { values[i] = value; if (--left === 0) resolve(values); }, reject);
    }
    if (--left === 0) resolve(values);
  });
}
async function main(): Promise<void> {
  let calls = 0; const thenable: Thenable = { then(resolve, reject): void { calls++; resolve(7); } };
  const inputs: Iterable<Item> = [thenable];
  interface Holder { xs: Iterable<Item>; } const holder: Holder = { xs: inputs }; const routed = holder.xs;
  const joined = localAll(routed);
  await joined;
  assert.sameValue(calls, 1);
  console.log("turns-all-then-once:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
