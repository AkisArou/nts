/*---
description: "all preserves number, string, null and stored undefined; route: private class field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all preserves number, string, null and stored undefined. Route: private class field. Node prints all-plain-nullish-private:ok.
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
  const inputs: Iterable<Entry> = [1, "a", null, undefined];
  class Queue { #items: Iterable<Entry>; constructor(items: Iterable<Entry>) { this.#items = items; } read(): Iterable<Entry> { return this.#items; } }
  const routed = new Queue(inputs).read();
  const joined = localAll(routed);
  const value = await joined;
  assert.compareArray(value, [1, "a", null, undefined]);
  console.log("all-plain-nullish-private:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
