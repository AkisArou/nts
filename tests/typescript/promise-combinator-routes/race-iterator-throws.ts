/*---
description: "An iterator-next exception rejects the race promise rather than throwing synchronously. Route: discriminated union"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// An iterator-next exception rejects the race promise rather than throwing synchronously. Route: discriminated union. Node prints race-iterator-throws:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const reason = new TypeError("next"); function bad(): Iterable<Item> { return { [Symbol.iterator](): Iterator<Item> { return { next(): IteratorResult<Item> { throw reason; } }; } }; }
  const inputs: Iterable<Item> = bad();
  type Choice = { kind: "yes"; xs: Iterable<Item> } | { kind: "no"; xs: Iterable<Item> }; const choice: Choice = { kind: "yes", xs: inputs }; const routed = choice.xs;
  const joined = Promise.race(routed);
  let caught: unknown; try { await joined; } catch (error: unknown) { caught = error; }
  assert.sameValue(caught, reason);
  console.log("race-iterator-throws:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
