/*---
description: "Throwing after thenable resolution does not alter fulfillment. Route: private field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// Throwing after thenable resolution does not alter fulfillment. Route: private field. Node prints settled-thenable-after-resolve:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
async function main(): Promise<void> {
  const reason = new Error("ignored"); const input: Thenable = { then(resolve, reject): void { resolve(7); throw reason; } };
  const inputs: Iterable<Item> = [input];
  class Shelf { #xs: Iterable<Item>; constructor(xs: Iterable<Item>) { this.#xs = xs; } get(): Iterable<Item> { return this.#xs; } } const routed = new Shelf(inputs).get();
  const joined = Promise.allSettled(routed);
  const value = await joined;
  assert.sameValue(value[0].status, "fulfilled"); if (value[0].status === "fulfilled") assert.sameValue(value[0].value, 7);
  console.log("settled-thenable-after-resolve:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
