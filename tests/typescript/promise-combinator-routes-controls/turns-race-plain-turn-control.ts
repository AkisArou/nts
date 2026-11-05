/*---
description: "Race of a plain value completes in turn 2. Route: constrained generic helper (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// Race of a plain value completes in turn 2. Route: constrained generic helper. Node prints turns-race-plain-turn:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function localRace<T>(xs: Iterable<T>): Promise<Awaited<T>> {
  return new Promise((resolve, reject) => {
    for (const input of xs) Promise.resolve(input).then(resolve, reject);
  });
}
async function main(): Promise<void> {
  const log: string[] = []; let ticker = Promise.resolve();
  for (let i = 1; i <= 5; i++) { const label = "t" + i; ticker = ticker.then(() => { log.push(label); }); }
  const inputs: Iterable<Item> = [1];
  function forward<T extends Item>(xs: Iterable<T>): Iterable<T> { return xs; } const routed = forward<Item>(inputs);
  const joined = localRace(routed);
  joined.then(() => log.push("callback"), () => log.push("callback"));
  await ticker;
  assert.compareArray(log, ["t1", "t2", "callback", "t3", "t4", "t5"]);
  console.log("turns-race-plain-turn:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
