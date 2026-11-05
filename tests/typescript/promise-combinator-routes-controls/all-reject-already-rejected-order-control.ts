/*---
description: "all chooses the earlier input among two already rejected promises; route: Map.get of a declared iterable (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all chooses the earlier input among two already rejected promises. Route: Map.get of a declared iterable. Node prints all-reject-already-rejected-order:ok.
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
  const first = { id: 5 };
  const second = { id: 6 };
  const inputs: Iterable<Entry> = [Promise.reject(first), Promise.reject(second)];
  const store = new Map<string, Iterable<Entry>>();
  store.set("chosen", inputs);
  const found = store.get("chosen");
  if (found === undefined) throw new Error("missing input");
  const routed = found;
  const joined = localAll(routed);
  let caught = false;
  let caughtError: unknown;
  try { await joined; } catch (error: unknown) { caught = true; caughtError = error; }
  assert.sameValue(caught, true);
  assert.sameValue(caughtError, first);
  console.log("all-reject-already-rejected-order:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
