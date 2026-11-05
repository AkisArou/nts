/*---
description: "All-rejection result is an AggregateError and also an Error. Route: discriminated union (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// All-rejection result is an AggregateError and also an Error. Route: discriminated union. Node prints any-aggregate-error-brand:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function localAny<T>(inputs: Iterable<T>): Promise<Awaited<T>> {
  return new Promise((resolve, reject) => {
    let count = 1, index = 0;
    const errors: unknown[] = [];
    for (const input of inputs) {
      const position = index++; count++;
      Promise.resolve(input).then(resolve, (reason: unknown) => {
        errors[position] = reason;
        if (--count === 0) reject(new AggregateError(errors));
      });
    }
    if (--count === 0) reject(new AggregateError(errors));
  });
}
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [Promise.reject("bad")];
  type Selection = { tag: "a"; xs: Iterable<Item> } | { tag: "b"; xs: Iterable<Item> }; const selected: Selection = { tag: "a", xs: inputs }; const routed = selected.xs;
  const result = localAny(routed);
  let caught: unknown; try { await result; } catch (error: unknown) { caught = error; }
  assert.sameValue(caught instanceof AggregateError, true); assert.sameValue(caught instanceof Error, true);
  if (caught instanceof AggregateError) { assert.sameValue(caught.constructor, AggregateError); assert.sameValue("errors" in caught, true); }
  console.log("any-aggregate-error-brand:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
