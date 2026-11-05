/*---
description: "AllSettled adopts a thenable asynchronously rather than during the call. Route: captured binding (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// AllSettled adopts a thenable asynchronously rather than during the call. Route: captured binding. Node prints turns-settled-then-async:ok.
type Value = number | string | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function localAllSettled<T>(xs: Iterable<T>): Promise<PromiseSettledResult<Awaited<T>>[]> {
  return new Promise(resolve => {
    const records: PromiseSettledResult<Awaited<T>>[] = []; let left = 1, index = 0;
    for (const input of xs) {
      const i = index++; left++;
      Promise.resolve(input).then(value => { records[i] = { status: "fulfilled", value }; if (--left === 0) resolve(records); },
        (reason: unknown) => { records[i] = { status: "rejected", reason }; if (--left === 0) resolve(records); });
    }
    if (--left === 0) resolve(records);
  });
}
async function main(): Promise<void> {
  const log: string[] = [];
  const thenable: Thenable = { then(resolve, reject): void { log.push("then"); resolve(7); } };
  const inputs: Iterable<Item> = [thenable];
  let captured: Iterable<Item> = inputs; const read = (): Iterable<Item> => captured; const routed = read();
  const joined = localAllSettled(routed);
  log.push("sync");
  await joined;
  assert.compareArray(log, ["sync", "then"]);
  console.log("turns-settled-then-async:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
