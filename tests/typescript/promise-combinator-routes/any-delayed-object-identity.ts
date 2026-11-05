/*---
description: "The first fulfilling object retains its reference identity. Route: discriminated union"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// The first fulfilling object retains its reference identity. Route: discriminated union. Node prints any-delayed-object-identity:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function delayed(value: Value, n: number): Promise<Value> { let job = Promise.resolve(); for (let i = 0; i < n; i++) job = job.then(() => undefined); return job.then(() => value); }
async function main(): Promise<void> {
  const older = { id: 1 }, winner = { id: 2 };
  const inputs: Iterable<Item> = [delayed(older, 3), delayed(winner, 1)];
  type Selection = { tag: "a"; xs: Iterable<Item> } | { tag: "b"; xs: Iterable<Item> }; const selected: Selection = { tag: "a", xs: inputs }; const routed = selected.xs;
  const result = Promise.any(routed);
  const value = await result;
  assert.sameValue(value, winner);
  console.log("any-delayed-object-identity:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
