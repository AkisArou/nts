/*---
description: "all returns a new array distinct from its array input; route: private class field"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all returns a new array distinct from its array input. Route: private class field. Node prints all-fresh-array-class:ok.
type Data = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Data) => void, reject: (reason: unknown) => void): void };
type Entry = Data | PromiseLike<Data> | Thenable;
async function main(): Promise<void> {
  const inputs: Entry[] = [1, 2, 3];
  class Queue { #items: Iterable<Entry>; constructor(items: Iterable<Entry>) { this.#items = items; } read(): Iterable<Entry> { return this.#items; } }
  const routed = new Queue(inputs).read();
  const joined = Promise.all(routed);
  const value = await joined;
  assert.compareArray(value, [1, 2, 3]);
  assert.sameValue(Object.is(value, inputs), false);
  console.log("all-fresh-array-class:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
