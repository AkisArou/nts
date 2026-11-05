/*---
description: "An early rejection wins over a later fulfillment. Route: discriminated union (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// An early rejection wins over a later fulfillment. Route: discriminated union. Node prints race-reject-before-fulfill:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function localRace<T>(inputs: Iterable<T>): Promise<Awaited<T>> {
  return new Promise((resolve, reject) => {
    for (const input of inputs) Promise.resolve(input).then(resolve, reject);
  });
}
function later(value: Value, n: number): Promise<Value> { let job = Promise.resolve(); for (let i = 0; i < n; i++) job = job.then(() => undefined); return job.then(() => value); }
function fail(reason: unknown, n: number): Promise<Value> { let job = Promise.resolve(); for (let i = 0; i < n; i++) job = job.then(() => undefined); return job.then(() => { throw reason; }); }
async function main(): Promise<void> {
  const reason = { id: 1 };
  const inputs: Iterable<Item> = [fail(reason, 1), later(8, 4)];
  type Choice = { kind: "yes"; xs: Iterable<Item> } | { kind: "no"; xs: Iterable<Item> }; const choice: Choice = { kind: "yes", xs: inputs }; const routed = choice.xs;
  const joined = localRace(routed);
  let caught: unknown; try { await joined; } catch (error: unknown) { caught = error; }
  assert.sameValue(caught, reason);
  console.log("race-reject-before-fulfill:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
