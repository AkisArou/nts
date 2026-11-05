/*---
description: "Separate any failures allocate independent AggregateError.errors arrays. Route: captured closure (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// Separate any failures allocate independent AggregateError.errors arrays. Route: captured closure. Node prints any-fresh-errors-arrays:ok.
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
  const inputs: Iterable<Item> = [Promise.reject("no")];
  let captured: Iterable<Item> = inputs; const take = (): Iterable<Item> => captured; const routed = take();
  const result = localAny(routed);
  let first: unknown, second: unknown;
  try { await result; } catch (error: unknown) { first = error; }
  try { await localAny(routed); } catch (error: unknown) { second = error; }
  if (!(first instanceof AggregateError) || !(second instanceof AggregateError)) throw new Error("expected aggregates");
  assert.sameValue(first.errors === second.errors, false);
  console.log("any-fresh-errors-arrays:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
