/*---
description: "Control: Awaiting compound add-uint8-element retains the pre-suspension reference and value."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-async, ts-interfaces, ts-functions, ts-arrow-functions, ts-arrays, ts-tuples, ts-iteration, ts-numbers, ts-objects, ts-typed-array-conversion]
flags: [async]
---*/
// += through add-uint8-element; node saves the original target and value across await while another task replaces both carriers.
const log: string[] = [];
interface Source { view: Uint8Array; wait(): Promise<number>; }
async function update(source: Source): Promise<number> {
  log.push("update");
  const target = source.view;
  const left = target[0];
  const receiver = source;
  const wait = receiver.wait;
  const task = wait.call(receiver);
  const right = await task;
  const result = left + right;
  target[0] = result;
  return result;
}
async function main(): Promise<void> {
  log.push("main");
  const rows: [number, number][] = [[250, 260], [255, 265]];
  for (const row of rows) {
    const gate = Promise.withResolvers<number>();
    const first: Uint8Array = new Uint8Array([row[0]]), second: Uint8Array = new Uint8Array([80]);
    const source: Source = { view: first, wait(): Promise<number> { log.push("wait"); return gate.promise; } };
    log.length = 0;
    const pending = update(source);
    Promise.resolve().then(() => { log.push("other"); first[0] = 100; source.view = second; gate.resolve(10); });
    const result = await pending;
    assert.compareArray(log, ["update", "wait", "other"]);
    assert.sameValue(result, row[1]);
    assert.sameValue(first[0], row[1] % 256);
    assert.sameValue(second[0], 80);
    assert.sameValue(source.view, second);
  }
}
main().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
