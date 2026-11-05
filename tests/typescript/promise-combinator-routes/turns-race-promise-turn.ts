/*---
description: "Race of an already fulfilled promise completes in turn 2. Route: interface field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// Race of an already fulfilled promise completes in turn 2. Route: interface field. Node prints turns-race-promise-turn:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const log: string[] = []; let ticker = Promise.resolve();
  for (let i = 1; i <= 5; i++) { const label = "t" + i; ticker = ticker.then(() => { log.push(label); }); }
  const inputs: Iterable<Item> = [Promise.resolve(1)];
  interface Holder { xs: Iterable<Item>; } const holder: Holder = { xs: inputs }; const routed = holder.xs;
  const joined = Promise.race(routed);
  joined.then(() => log.push("callback"), () => log.push("callback"));
  await ticker;
  assert.compareArray(log, ["t1", "t2", "callback", "t3", "t4", "t5"]);
  console.log("turns-race-promise-turn:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
