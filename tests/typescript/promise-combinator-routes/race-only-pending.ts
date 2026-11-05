/*---
description: "A single indefinitely pending input leaves race pending. Route: captured closure"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// A single indefinitely pending input leaves race pending. Route: captured closure. Node prints race-only-pending:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [new Promise<Value>(() => {})];
  let retained: Iterable<Item> = inputs; const reader = (): Iterable<Item> => retained; const routed = reader();
  const joined = Promise.race(routed);
  let settled = false;
  joined.then(() => { settled = true; }, () => { settled = true; });
  let turns = Promise.resolve();
  for (let i = 0; i < 10; i++) turns = turns.then(() => undefined);
  await turns;
  assert.sameValue(settled, false);
  console.log("race-only-pending:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
