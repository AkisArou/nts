/*---
description: "A rejected record preserves its reason without value. Route: private field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// A rejected record preserves its reason without value. Route: private field. Node prints settled-single-rejected:ok.
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
async function main(): Promise<void> {
  const reason = new TypeError("fault");
  const inputs: Iterable<Item> = [Promise.reject(reason)];
  class Shelf { #xs: Iterable<Item>; constructor(xs: Iterable<Item>) { this.#xs = xs; } get(): Iterable<Item> { return this.#xs; } } const routed = new Shelf(inputs).get();
  const joined = localAllSettled(routed);
  const value = await joined;
  assert.sameValue(value[0].status, "rejected"); assert.sameValue("value" in value[0], false); if (value[0].status === "rejected") assert.sameValue(value[0].reason, reason);
  console.log("settled-single-rejected:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
