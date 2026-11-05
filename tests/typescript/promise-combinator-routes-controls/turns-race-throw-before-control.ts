/*---
description: "Race rejects with a thenable's thrown reason before settlement. Route: static class field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// Race rejects with a thenable's thrown reason before settlement. Route: static class field. Node prints turns-race-throw-before:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function localRace<T>(xs: Iterable<T>): Promise<Awaited<T>> {
  return new Promise((resolve, reject) => {
    for (const input of xs) Promise.resolve(input).then(resolve, reject);
  });
}
async function main(): Promise<void> {
  const reason = new RangeError("reason");
  const thenable: Thenable = { then(resolve, reject): void { throw reason; } };
  const inputs: Iterable<Item> = [thenable];
  class StaticStore { static xs: Iterable<Item>; } StaticStore.xs = inputs; const routed = StaticStore.xs;
  const joined = localRace(routed);
  let caught: unknown; try { await joined; } catch (error: unknown) { caught = error; }
  assert.sameValue(caught, reason);
  console.log("turns-race-throw-before:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
