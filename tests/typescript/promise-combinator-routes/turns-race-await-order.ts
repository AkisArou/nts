/*---
description: "Await of race resumes in turn 2 after its earlier registered then callback. Route: Map lookup"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// Await of race resumes in turn 2 after its earlier registered then callback. Route: Map lookup. Node prints turns-race-await-order:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const log: string[] = []; let ticker = Promise.resolve();
  for (let i = 1; i <= 5; i++) { const label = "t" + i; ticker = ticker.then(() => { log.push(label); }); }
  const inputs: Iterable<Item> = [1];
  const map = new Map<string, Iterable<Item>>(); map.set("x", inputs); const stored = map.get("x"); if (stored === undefined) throw new Error("missing"); const routed = stored;
  const joined = Promise.race(routed);
  joined.then(() => { log.push("then"); });
  const observer = (async (): Promise<void> => { await joined; log.push("await"); })();
  await ticker; await observer;
  assert.compareArray(log, ["t1", "t2", "then", "await", "t3", "t4", "t5"]);
  console.log("turns-race-await-order:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
