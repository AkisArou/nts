/*---
description: "two calls to all produce independent result arrays; route: generic typed forwarding helper (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// two calls to all produce independent result arrays. Route: generic typed forwarding helper. Node prints all-fresh-each-call-generic:ok.
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
  const inputs: Entry[] = [4, 5];
  function forward<T extends Entry>(source: Iterable<T>): Iterable<T> { return source; }
  const routed = forward<Entry>(inputs);
  const joined = localAll(routed);
  const value = await joined;
  const another = await localAll(routed);
  assert.compareArray(value, [4, 5]);
  assert.compareArray(another, [4, 5]);
  assert.sameValue(Object.is(value, another), false);
  console.log("all-fresh-each-call-generic:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
