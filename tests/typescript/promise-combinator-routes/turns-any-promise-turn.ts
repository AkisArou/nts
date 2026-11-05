/*---
description: "Any of an already fulfilled promise completes in turn 2. Route: discriminated union"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// Any of an already fulfilled promise completes in turn 2. Route: discriminated union. Node prints turns-any-promise-turn:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const log: string[] = []; let ticker = Promise.resolve();
  for (let i = 1; i <= 5; i++) { const label = "t" + i; ticker = ticker.then(() => { log.push(label); }); }
  const inputs: Iterable<Item> = [Promise.resolve(1)];
  type Source = { tag: "yes"; xs: Iterable<Item> } | { tag: "no"; xs: Iterable<Item> }; const selected: Source = { tag: "yes", xs: inputs }; const routed = selected.xs;
  const joined = Promise.any(routed);
  joined.then(() => log.push("callback"), () => log.push("callback"));
  await ticker;
  assert.compareArray(log, ["t1", "t2", "callback", "t3", "t4", "t5"]);
  console.log("turns-any-promise-turn:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
