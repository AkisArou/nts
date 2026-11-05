/*---
description: "Separate any failures allocate independent AggregateError.errors arrays. Route: captured closure"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// Separate any failures allocate independent AggregateError.errors arrays. Route: captured closure. Node prints any-fresh-errors-arrays:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const inputs: Iterable<Item> = [Promise.reject("no")];
  let captured: Iterable<Item> = inputs; const take = (): Iterable<Item> => captured; const routed = take();
  const result = Promise.any(routed);
  let first: unknown, second: unknown;
  try { await result; } catch (error: unknown) { first = error; }
  try { await Promise.any(routed); } catch (error: unknown) { second = error; }
  if (!(first instanceof AggregateError) || !(second instanceof AggregateError)) throw new Error("expected aggregates");
  assert.sameValue(first.errors === second.errors, false);
  console.log("any-fresh-errors-arrays:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
