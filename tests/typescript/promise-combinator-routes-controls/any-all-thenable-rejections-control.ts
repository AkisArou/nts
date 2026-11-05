/*---
description: "Rejected thenables contribute original reasons in their input order. Route: captured closure (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// Rejected thenables contribute original reasons in their input order. Route: captured closure. Node prints any-all-thenable-rejections:ok.
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
  const a: Thenable = { then(resolve, reject): void { reject("a"); } }; const b: Thenable = { then(resolve, reject): void { reject("b"); } };
  const inputs: Iterable<Item> = [a, b];
  let captured: Iterable<Item> = inputs; const take = (): Iterable<Item> => captured; const routed = take();
  const result = localAny(routed);
  let caught: unknown; try { await result; } catch (error: unknown) { caught = error; }
  if (!(caught instanceof AggregateError)) throw new Error("expected AggregateError");
  assert.sameValue(caught.constructor, AggregateError); assert.sameValue(caught instanceof Error, true);
  assert.sameValue("errors" in caught, true); assert.compareArray(caught.errors, ["a","b"]);
  console.log("any-all-thenable-rejections:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
