/*---
description: "all fills holes of a length-only number array with owned undefined; route: private class field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all fills holes of a length-only number array with owned undefined. Route: private class field. Node prints all-sparse-length-number-array:ok.
type Data = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Data) => void, reject: (reason: unknown) => void): void };
type Entry = Data | PromiseLike<Data> | Thenable;
function localAll<T>(inputs: Iterable<T>): Promise<Awaited<T>[]> {
  return new Promise((resolve, reject) => {
    const values: Awaited<T>[] = [];
    let remaining = 1;
    let position = 0;
    for (const input of inputs) {
      const index = position++;
      remaining++;
      Promise.resolve(input).then(value => {
        values[index] = value;
        remaining--;
        if (remaining === 0) resolve(values);
      }, reject);
    }
    remaining--;
    if (remaining === 0) resolve(values);
  });
}
async function main(): Promise<void> {
  const inputs: number[] = new Array<number>(2);
  class Queue { #items: Iterable<Entry>; constructor(items: Iterable<Entry>) { this.#items = items; } read(): Iterable<Entry> { return this.#items; } }
  const routed = new Queue(inputs).read();
  const joined = localAll(routed);
  const value = await joined;
  assert.compareArray(value, [undefined, undefined]);
  const own: boolean[] = [];
  for (let i = 0; i < value.length; i++) own.push(i in value);
  assert.compareArray(own, [true, true]);
  console.log("all-sparse-length-number-array:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
