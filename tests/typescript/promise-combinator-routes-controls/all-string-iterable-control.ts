/*---
description: "all accepts string iteration and returns individual characters; route: interface input field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all accepts string iteration and returns individual characters. Route: interface input field. Node prints all-string-iterable:ok.
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
  const inputs: Iterable<Entry> = "ab";
  interface Holder { readonly items: Iterable<Entry>; }
  const owner: Holder = { items: inputs };
  const routed = owner.items;
  const joined = localAll(routed);
  const value = await joined;
  assert.compareArray(value, ["a", "b"]);
  console.log("all-string-iterable:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
