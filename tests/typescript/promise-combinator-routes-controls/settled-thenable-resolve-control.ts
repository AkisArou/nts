/*---
description: "A typed thenable is adopted once into a fulfilled record. Route: static field (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// A typed thenable is adopted once into a fulfilled record. Route: static field. Node prints settled-thenable-resolve:ok.
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
  let calls = 0; const input: Thenable = { then(resolve, reject): void { calls++; resolve(9); } };
  const inputs: Iterable<Item> = [input];
  class Owner { static xs: Iterable<Item>; } Owner.xs = inputs; const routed = Owner.xs;
  const joined = localAllSettled(routed);
  const value = await joined;
  assert.sameValue(calls, 1); assert.sameValue(value[0].status, "fulfilled"); if (value[0].status === "fulfilled") assert.sameValue(value[0].value, 9);
  console.log("settled-thenable-resolve:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
