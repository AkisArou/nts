/*---
description: "Await of an all result resumes in turn 2 after its earlier registered then callback. Route: private class field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// Await of an all result resumes in turn 2 after its earlier registered then callback. Route: private class field. Node prints turns-all-await-order:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function localAll<T>(xs: Iterable<T>): Promise<Awaited<T>[]> {
  return new Promise((resolve, reject) => {
    const values: Awaited<T>[] = []; let left = 1, index = 0;
    for (const input of xs) {
      const i = index++; left++;
      Promise.resolve(input).then(value => { values[i] = value; if (--left === 0) resolve(values); }, reject);
    }
    if (--left === 0) resolve(values);
  });
}
async function main(): Promise<void> {
  const log: string[] = []; let ticker = Promise.resolve();
  for (let i = 1; i <= 5; i++) { const label = "t" + i; ticker = ticker.then(() => { log.push(label); }); }
  const inputs: Iterable<Item> = [1];
  class Store { #xs: Iterable<Item>; constructor(xs: Iterable<Item>) { this.#xs = xs; } get(): Iterable<Item> { return this.#xs; } } const routed = new Store(inputs).get();
  const joined = localAll(routed);
  joined.then(() => { log.push("then"); });
  const observer = (async (): Promise<void> => { await joined; log.push("await"); })();
  await ticker; await observer;
  assert.compareArray(log, ["t1", "t2", "then", "await", "t3", "t4", "t5"]);
  console.log("turns-all-await-order:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
