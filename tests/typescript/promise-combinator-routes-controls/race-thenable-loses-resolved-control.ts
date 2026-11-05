/*---
description: "A synchronously resolving thenable loses to a later already-fulfilled promise. Route: static class field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// A synchronously resolving thenable loses to a later already-fulfilled promise. Route: static class field. Node prints race-thenable-loses-resolved:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function localRace<T>(inputs: Iterable<T>): Promise<Awaited<T>> {
  return new Promise((resolve, reject) => {
    for (const input of inputs) Promise.resolve(input).then(resolve, reject);
  });
}
async function main(): Promise<void> {
  const thenable: Thenable = { then(resolve, reject): void { resolve(9); } };
  const inputs: Iterable<Item> = [thenable, Promise.resolve(7)];
  class Owner { static xs: Iterable<Item>; } Owner.xs = inputs; const routed = Owner.xs;
  const joined = localRace(routed);
  const value = await joined;
  assert.sameValue(value, 7);
  console.log("race-thenable-loses-resolved:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
