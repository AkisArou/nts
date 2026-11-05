/*---
description: "AllSettled of an already fulfilled promise completes in turn 2. Route: readonly tuple row"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// AllSettled of an already fulfilled promise completes in turn 2. Route: readonly tuple row. Node prints turns-settled-promise-turn:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const log: string[] = []; let ticker = Promise.resolve();
  for (let i = 1; i <= 5; i++) { const label = "t" + i; ticker = ticker.then(() => { log.push(label); }); }
  const inputs: Iterable<Item> = [Promise.resolve(1)];
  const rows: readonly [string, Iterable<Item>][] = [["x", inputs]]; const routed = rows[0][1];
  const joined = Promise.allSettled(routed);
  joined.then(() => log.push("callback"), () => log.push("callback"));
  await ticker;
  assert.compareArray(log, ["t1", "t2", "callback", "t3", "t4", "t5"]);
  console.log("turns-settled-promise-turn:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
