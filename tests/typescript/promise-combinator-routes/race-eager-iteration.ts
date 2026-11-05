/*---
description: "Race exhausts the iterable during its synchronous call. Route: captured closure"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// Race exhausts the iterable during its synchronous call. Route: captured closure. Node prints race-eager-iteration:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const log: string[] = []; function* stream(): Generator<Item> { log.push("first"); yield 1; log.push("second"); yield 2; }
  const inputs: Iterable<Item> = stream();
  let retained: Iterable<Item> = inputs; const reader = (): Iterable<Item> => retained; const routed = reader();
  const joined = Promise.race(routed);
  assert.compareArray(log, ["first", "second"]);
  const value = await joined;
  assert.compareArray(log, ["first", "second"]); assert.sameValue(value, 1);
  console.log("race-eager-iteration:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
