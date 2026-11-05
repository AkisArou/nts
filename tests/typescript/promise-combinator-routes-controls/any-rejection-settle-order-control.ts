/*---
description: "AggregateError.errors preserves input order despite reversed rejection timing. Route: private class field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// AggregateError.errors preserves input order despite reversed rejection timing. Route: private class field. Node prints any-rejection-settle-order:ok.
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
function fail(reason: unknown, n: number): Promise<Value> { let job = Promise.resolve(); for (let i = 0; i < n; i++) job = job.then(() => undefined); return job.then(() => { throw reason; }); }
async function main(): Promise<void> {
  const a = { id: 3 }, b = { id: 4 };
  const inputs: Iterable<Item> = [fail(a, 4), fail(b, 1)];
  class Shelf { #xs: Iterable<Item>; constructor(xs: Iterable<Item>) { this.#xs = xs; } read(): Iterable<Item> { return this.#xs; } } const routed = new Shelf(inputs).read();
  const result = localAny(routed);
  let caught: unknown; try { await result; } catch (error: unknown) { caught = error; }
  if (!(caught instanceof AggregateError)) throw new Error("expected AggregateError");
  assert.sameValue(caught.constructor, AggregateError); assert.sameValue(caught instanceof Error, true);
  assert.sameValue("errors" in caught, true); assert.compareArray(caught.errors, [a,b]);
  console.log("any-rejection-settle-order:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
