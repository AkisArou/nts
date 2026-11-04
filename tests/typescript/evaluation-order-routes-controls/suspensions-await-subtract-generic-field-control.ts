/*---
description: "Control: Awaiting compound subtract-generic-field retains the pre-suspension reference and value."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-async, ts-interfaces, ts-functions, ts-arrow-functions, ts-arrays, ts-tuples, ts-iteration, ts-numbers, ts-objects, ts-generics, ts-generic-constraints]
flags: [async]
---*/
// -= through subtract-generic-field; node saves the original target and value across await while another task replaces both carriers.
const log: string[] = [];
interface Source { cell: { value: number }; wait(): Promise<number>; }
async function update<T extends Source>(source: T): Promise<number> {
  log.push("update");
  const target = source.cell;
  const left = target.value;
  const receiver = source;
  const wait = receiver.wait;
  const task = wait.call(receiver);
  const right = await task;
  const result = left - right;
  target.value = result;
  return result;
}
async function main(): Promise<void> {
  log.push("main");
  const rows: [number, number][] = [[8, 5], [20, 17]];
  for (const row of rows) {
    const gate = Promise.withResolvers<number>();
    const first: { value: number } = { value: row[0] }, second: { value: number } = { value: 80 };
    const source: Source = { cell: first, wait(): Promise<number> { log.push("wait"); return gate.promise; } };
    log.length = 0;
    const pending = update(source);
    Promise.resolve().then(() => { log.push("other"); first.value = 100; source.cell = second; gate.resolve(3); });
    const result = await pending;
    assert.compareArray(log, ["update", "wait", "other"]);
    assert.sameValue(result, row[1]);
    assert.sameValue(first.value, row[1]);
    assert.sameValue(second.value, 80);
    assert.sameValue(source.cell, second);
  }
}
main().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
