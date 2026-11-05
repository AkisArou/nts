/*---
description: "The status discriminant selects value versus reason. Route: discriminated union (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-settled, ts-async]
flags: [async]
---*/

// The status discriminant selects value versus reason. Route: discriminated union. Node prints settled-status-narrowing:ok.
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
  const reason = { id: 3 };
  const inputs: Iterable<Item> = ["ok", Promise.reject(reason)];
  type Choice = { tag: "yes"; xs: Iterable<Item> } | { tag: "no"; xs: Iterable<Item> }; const choice: Choice = { tag: "yes", xs: inputs }; const routed = choice.xs;
  const joined = localAllSettled(routed);
  const value = await joined;
  const labels: string[] = []; for (const item of value) { if (item.status === "fulfilled") labels.push("value:" + item.value); else labels.push(item.reason === reason ? "original" : "wrong"); } assert.compareArray(labels, ["value:ok", "original"]);
  console.log("settled-status-narrowing:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
