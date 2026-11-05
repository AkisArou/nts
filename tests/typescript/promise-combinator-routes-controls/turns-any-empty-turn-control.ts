/*---
description: "Empty any rejects in microtask turn 1. Route: static class field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// Empty any rejects in microtask turn 1. Route: static class field. Node prints turns-any-empty-turn:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function localAny<T>(xs: Iterable<T>): Promise<Awaited<T>> {
  return new Promise((resolve, reject) => {
    const errors: unknown[] = []; let left = 1, index = 0;
    for (const input of xs) {
      const i = index++; left++;
      Promise.resolve(input).then(resolve, (reason: unknown) => { errors[i] = reason; if (--left === 0) reject(new AggregateError(errors)); });
    }
    if (--left === 0) reject(new AggregateError(errors));
  });
}
async function main(): Promise<void> {
  const log: string[] = []; let ticker = Promise.resolve();
  for (let i = 1; i <= 5; i++) { const label = "t" + i; ticker = ticker.then(() => { log.push(label); }); }
  const inputs: Iterable<Item> = [];
  class StaticStore { static xs: Iterable<Item>; } StaticStore.xs = inputs; const routed = StaticStore.xs;
  const joined = localAny(routed);
  joined.then(() => log.push("callback"), () => log.push("callback"));
  await ticker;
  assert.compareArray(log, ["t1", "callback", "t2", "t3", "t4", "t5"]);
  console.log("turns-any-empty-turn:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
