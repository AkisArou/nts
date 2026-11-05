/*---
description: "Mixed fulfillments and rejections retain input positions. Route: interface field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// Mixed fulfillments and rejections retain input positions. Route: interface field. Node prints settled-mixed-delay:ok.
type Value = number | string | null | undefined | { id: number };
type Thenable = { then(resolve: (value: Value) => void, reject: (reason: unknown) => void): void };
type Item = Value | PromiseLike<Value> | Thenable;
function localAllSettled<T>(items: Iterable<T>): Promise<PromiseSettledResult<Awaited<T>>[]> {
  return new Promise(resolve => {
    const records: PromiseSettledResult<Awaited<T>>[] = [];
    let count = 1, index = 0;
    for (const input of items) {
      const i = index++; count++;
      Promise.resolve(input).then(value => { records[i] = { status: "fulfilled", value }; if (--count === 0) resolve(records); },
        (reason: unknown) => { records[i] = { status: "rejected", reason }; if (--count === 0) resolve(records); });
    }
    if (--count === 0) resolve(records);
  });
}
function delayed(value: Value, n: number): Promise<Value> { let job = Promise.resolve(); for (let i = 0; i < n; i++) job = job.then(() => undefined); return job.then(() => value); }
async function main(): Promise<void> {
  const reason = { id: 1 };
  const inputs: Iterable<Item> = [delayed(1, 3), Promise.reject(reason), 3];
  interface Source { entries: Iterable<Item>; } const source: Source = { entries: inputs }; const routed = source.entries;
  const joined = localAllSettled(routed);
  const value = await joined;
  assert.compareArray(value.map(x => x.status), ["fulfilled", "rejected", "fulfilled"]); if (value[1].status === "rejected") assert.sameValue(value[1].reason, reason);
  console.log("settled-mixed-delay:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
