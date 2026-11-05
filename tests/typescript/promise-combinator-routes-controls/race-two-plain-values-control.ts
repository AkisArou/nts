/*---
description: "The earlier position wins among two plain values. Route: private class field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-race, ts-async]
flags: [async]
---*/

// The earlier position wins among two plain values. Route: private class field. Node prints race-two-plain-values:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function localRace<T>(inputs: Iterable<T>): Promise<Awaited<T>> {
  return new Promise((resolve, reject) => {
    for (const input of inputs) Promise.resolve(input).then(resolve, reject);
  });
}
async function main(): Promise<void> {
  const inputs: Iterable<Item> = ["a", "b"];
  class Shelf { #xs: Iterable<Item>; constructor(xs: Iterable<Item>) { this.#xs = xs; } get(): Iterable<Item> { return this.#xs; } } const routed = new Shelf(inputs).get();
  const joined = localRace(routed);
  const value = await joined;
  assert.sameValue(value, "a");
  console.log("race-two-plain-values:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
