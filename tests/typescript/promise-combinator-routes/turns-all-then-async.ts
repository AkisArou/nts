/*---
description: "All invokes a thenable's then only after the current synchronous code. Route: readonly tuple row"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// All invokes a thenable's then only after the current synchronous code. Route: readonly tuple row. Node prints turns-all-then-async:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const log: string[] = [];
  const thenable: Thenable = { then(resolve, reject): void { log.push("then"); resolve(7); } };
  const inputs: Iterable<Item> = [thenable];
  const rows: readonly [string, Iterable<Item>][] = [["x", inputs]]; const routed = rows[0][1];
  const joined = Promise.all(routed);
  log.push("sync");
  await joined;
  assert.compareArray(log, ["sync", "then"]);
  console.log("turns-all-then-async:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
