/*---
description: "Any of a plain value completes in turn 2. Route: constrained generic helper"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// Any of a plain value completes in turn 2. Route: constrained generic helper. Node prints turns-any-plain-turn:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const log: string[] = []; let ticker = Promise.resolve();
  for (let i = 1; i <= 5; i++) { const label = "t" + i; ticker = ticker.then(() => { log.push(label); }); }
  const inputs: Iterable<Item> = [1];
  function forward<T extends Item>(xs: Iterable<T>): Iterable<T> { return xs; } const routed = forward<Item>(inputs);
  const joined = Promise.any(routed);
  joined.then(() => log.push("callback"), () => log.push("callback"));
  await ticker;
  assert.compareArray(log, ["t1", "t2", "callback", "t3", "t4", "t5"]);
  console.log("turns-any-plain-turn:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
