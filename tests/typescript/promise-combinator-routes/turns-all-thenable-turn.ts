/*---
description: "All of a thenable adds a third microtask turn. Route: Map lookup"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// All of a thenable adds a third microtask turn. Route: Map lookup. Node prints turns-all-thenable-turn:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const log: string[] = []; let ticker = Promise.resolve();
  for (let i = 1; i <= 5; i++) { const label = "t" + i; ticker = ticker.then(() => { log.push(label); }); }
  const thenable: Thenable = { then(resolve, reject): void { resolve(7); } };
  const inputs: Iterable<Item> = [thenable];
  const map = new Map<string, Iterable<Item>>(); map.set("x", inputs); const stored = map.get("x"); if (stored === undefined) throw new Error("missing"); const routed = stored;
  const joined = Promise.all(routed);
  joined.then(() => log.push("callback"), () => log.push("callback"));
  await ticker;
  assert.compareArray(log, ["t1", "t2", "t3", "callback", "t4", "t5"]);
  console.log("turns-all-thenable-turn:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
