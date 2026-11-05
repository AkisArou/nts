/*---
description: "all rejects on a throwing iterator next without calling its return method; route: captured input closure (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-all, ts-async]
flags: [async]
---*/

// all rejects on a throwing iterator next without calling its return method. Route: captured input closure. Node prints all-throwing-next-no-return:ok.
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
  const reason = new TypeError("next");
  const log: string[] = [];
  const inputs: Iterable<Entry> = { [Symbol.iterator](): Iterator<Entry> { let step = 0; return { next(): IteratorResult<Entry> { log.push("next"); if (step++ === 0) return { done: false, value: 1 }; throw reason; }, return(): IteratorResult<Entry> { log.push("return"); return { done: true, value: undefined }; } }; } };
  let selected: Iterable<Entry> = inputs;
  const getSelected = (): Iterable<Entry> => selected;
  const routed = getSelected();
  const joined = localAll(routed);
  let caught = false;
  let caughtError: unknown;
  try { await joined; } catch (error: unknown) { caught = true; caughtError = error; }
  assert.sameValue(caught, true);
  assert.sameValue(caughtError, reason);
  assert.compareArray(log, ["next", "next"]);
  console.log("all-throwing-next-no-return:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
