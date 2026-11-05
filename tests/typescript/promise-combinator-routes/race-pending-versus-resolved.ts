/*---
description: "An already resolved input settles race despite a pending predecessor. Route: discriminated union"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// An already resolved input settles race despite a pending predecessor. Route: discriminated union. Node prints race-pending-versus-resolved:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [new Promise<Value>(() => {}), Promise.resolve("ready")];
  type Choice = { kind: "yes"; xs: Iterable<Item> } | { kind: "no"; xs: Iterable<Item> }; const choice: Choice = { kind: "yes", xs: inputs }; const routed = choice.xs;
  const joined = Promise.race(routed);
  const value = await joined;
  assert.sameValue(value, "ready");
  console.log("race-pending-versus-resolved:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
