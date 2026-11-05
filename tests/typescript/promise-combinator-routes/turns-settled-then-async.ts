/*---
description: "AllSettled adopts a thenable asynchronously rather than during the call. Route: captured binding"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// AllSettled adopts a thenable asynchronously rather than during the call. Route: captured binding. Node prints turns-settled-then-async:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const log: string[] = [];
  const thenable: Thenable = { then(resolve, reject): void { log.push("then"); resolve(7); } };
  const inputs: Iterable<Item> = [thenable];
  let captured: Iterable<Item> = inputs; const read = (): Iterable<Item> => captured; const routed = read();
  const joined = Promise.allSettled(routed);
  log.push("sync");
  await joined;
  assert.compareArray(log, ["sync", "then"]);
  console.log("turns-settled-then-async:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
