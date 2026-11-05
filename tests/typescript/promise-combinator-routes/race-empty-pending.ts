/*---
description: "An empty iterable remains pending for ten microtask turns. Route: readonly tuple row"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// An empty iterable remains pending for ten microtask turns. Route: readonly tuple row. Node prints race-empty-pending:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [];
  const rows: readonly [string, Iterable<Item>][] = [["x", inputs]]; const routed = rows[0][1];
  const joined = Promise.race(routed);
  let settled = false;
  joined.then(() => { settled = true; }, () => { settled = true; });
  let turns = Promise.resolve();
  for (let i = 0; i < 10; i++) turns = turns.then(() => undefined);
  await turns;
  assert.sameValue(settled, false);
  console.log("race-empty-pending:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
