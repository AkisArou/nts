/*---
description: "AllSettled of an already rejected promise fulfills in turn 2. Route: captured binding (control)"
features: [ts-promise-combinator-routes, ts-promise-combinator-route-turns, ts-async]
flags: [async]
---*/

// AllSettled of an already rejected promise fulfills in turn 2. Route: captured binding. Node prints turns-settled-rejected-turn:ok.
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
  const log: string[] = []; let ticker = Promise.resolve();
  for (let i = 1; i <= 5; i++) { const label = "t" + i; ticker = ticker.then(() => { log.push(label); }); }
  const inputs: Iterable<Item> = [Promise.reject("no")];
  let captured: Iterable<Item> = inputs; const read = (): Iterable<Item> => captured; const routed = read();
  const joined = localAllSettled(routed);
  joined.then(() => log.push("callback"), () => log.push("callback"));
  await ticker;
  assert.compareArray(log, ["t1", "t2", "callback", "t3", "t4", "t5"]);
  console.log("turns-settled-rejected-turn:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
