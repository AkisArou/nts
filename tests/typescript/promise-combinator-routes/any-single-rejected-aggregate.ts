/*---
description: "One rejection yields AggregateError containing the identical reason. Route: interface field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-any, ts-async]
flags: [async]
---*/

// One rejection yields AggregateError containing the identical reason. Route: interface field. Node prints any-single-rejected-aggregate:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const reason = { id: 2 };
  const inputs: Iterable<Item> = [Promise.reject(reason)];
  interface Bag { xs: Iterable<Item>; } const bag: Bag = { xs: inputs }; const routed = bag.xs;
  const result = Promise.any(routed);
  let caught: unknown; try { await result; } catch (error: unknown) { caught = error; }
  if (!(caught instanceof AggregateError)) throw new Error("expected AggregateError");
  assert.sameValue(caught.constructor, AggregateError); assert.sameValue(caught instanceof Error, true);
  assert.sameValue("errors" in caught, true); assert.compareArray(caught.errors, [reason]);
  console.log("any-single-rejected-aggregate:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
