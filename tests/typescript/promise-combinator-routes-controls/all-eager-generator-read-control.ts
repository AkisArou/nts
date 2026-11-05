/*---
description: "all exhausts its input generator synchronously during the call; route: Map.get of a declared iterable (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all exhausts its input generator synchronously during the call. Route: Map.get of a declared iterable. Node prints all-eager-generator-read:ok.
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
  const log: string[] = [];
  function* stream(): Generator<Entry> { log.push("first"); yield 1; log.push("second"); yield 2; }
  const inputs: Iterable<Entry> = stream();
  const store = new Map<string, Iterable<Entry>>();
  store.set("chosen", inputs);
  const found = store.get("chosen");
  if (found === undefined) throw new Error("missing input");
  const routed = found;
  const joined = localAll(routed);
  assert.compareArray(log, ["first", "second"]);
  const value = await joined;
  assert.compareArray(log, ["first", "second"]);
  assert.compareArray(value, [1, 2]);
  console.log("all-eager-generator-read:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
