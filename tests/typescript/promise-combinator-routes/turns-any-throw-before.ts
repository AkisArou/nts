/*---
description: "Any aggregates the reason thrown by a thenable before settlement. Route: discriminated union"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// Any aggregates the reason thrown by a thenable before settlement. Route: discriminated union. Node prints turns-any-throw-before:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const reason = new RangeError("reason");
  const thenable: Thenable = { then(resolve, reject): void { throw reason; } };
  const inputs: Iterable<Item> = [thenable];
  type Source = { tag: "yes"; xs: Iterable<Item> } | { tag: "no"; xs: Iterable<Item> }; const selected: Source = { tag: "yes", xs: inputs }; const routed = selected.xs;
  const joined = Promise.any(routed);
  let caught: unknown; try { await joined; } catch (error: unknown) { caught = error; }
  if (!(caught instanceof AggregateError)) throw new Error("expected AggregateError");
  assert.compareArray(caught.errors, [reason]);
  console.log("turns-any-throw-before:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
