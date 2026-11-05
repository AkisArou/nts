/*---
description: "Race adopts a thenable asynchronously rather than during the call. Route: static class field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// Race adopts a thenable asynchronously rather than during the call. Route: static class field. Node prints turns-race-then-async:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const log: string[] = [];
  const thenable: Thenable = { then(resolve, reject): void { log.push("then"); resolve(7); } };
  const inputs: Iterable<Item> = [thenable];
  class StaticStore { static xs: Iterable<Item>; } StaticStore.xs = inputs; const routed = StaticStore.xs;
  const joined = Promise.race(routed);
  log.push("sync");
  await joined;
  assert.compareArray(log, ["sync", "then"]);
  console.log("turns-race-then-async:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
