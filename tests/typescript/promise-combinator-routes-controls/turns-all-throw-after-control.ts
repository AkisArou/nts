/*---
description: "All ignores an exception thrown after thenable resolve. Route: readonly tuple row (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// All ignores an exception thrown after thenable resolve. Route: readonly tuple row. Node prints turns-all-throw-after:ok.
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
  const reason = new RangeError("reason");
  const thenable: Thenable = { then(resolve, reject): void { resolve(7); throw reason; } };
  const inputs: Iterable<Item> = [thenable];
  const rows: readonly [string, Iterable<Item>][] = [["x", inputs]]; const routed = rows[0][1];
  const joined = localAll(routed);
  const value = await joined;
  assert.compareArray(value, [7]);
  console.log("turns-all-throw-after:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
