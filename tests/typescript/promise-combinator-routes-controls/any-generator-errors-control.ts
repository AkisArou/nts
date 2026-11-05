/*---
description: "Generator yield order determines AggregateError.errors order. Route: interface field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// Generator yield order determines AggregateError.errors order. Route: interface field. Node prints any-generator-errors:ok.
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
  function* stream(): Generator<Item> { yield Promise.reject("a"); yield Promise.reject("b"); }
  const inputs: Iterable<Item> = stream();
  interface Bag { xs: Iterable<Item>; } const bag: Bag = { xs: inputs }; const routed = bag.xs;
  const result = localAny(routed);
  let caught: unknown; try { await result; } catch (error: unknown) { caught = error; }
  if (!(caught instanceof AggregateError)) throw new Error("expected AggregateError");
  assert.sameValue(caught.constructor, AggregateError); assert.sameValue(caught instanceof Error, true);
  assert.sameValue("errors" in caught, true); assert.compareArray(caught.errors, ["a","b"]);
  console.log("any-generator-errors:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
