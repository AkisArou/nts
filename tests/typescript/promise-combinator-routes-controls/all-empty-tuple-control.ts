/*---
description: "all of an empty iterable resolves with an empty array; route: readonly tuple row (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all of an empty iterable resolves with an empty array. Route: readonly tuple row. Node prints all-empty-tuple:ok.
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
  const inputs: Iterable<Entry> = [];
  const rows: readonly [string, Iterable<Entry>][] = [["chosen", inputs]];
  const routed = rows[0][1];
  const joined = localAll(routed);
  const value = await joined;
  assert.compareArray(value, []);
  assert.sameValue(value.length, 0);
  console.log("all-empty-tuple:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
