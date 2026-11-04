/*---
description: "Awaiting compound divide-tuple-element retains the pre-suspension reference and value."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-async, ts-interfaces, ts-functions, ts-arrow-functions, ts-arrays, ts-tuples, ts-iteration, ts-numbers, ts-objects]
flags: [async]
---*/
// /= through divide-tuple-element; node saves the original target and value across await while another task replaces both carriers.
const log: string[] = [];
interface Source { values: [number, number]; wait(): Promise<number>; }
async function update(source: Source): Promise<number> {
  log.push("update");
  return source.values[1] /= await source.wait();
}
async function main(): Promise<void> {
  log.push("main");
  const rows: [number, number][] = [[8, 4], [20, 10]];
  for (const row of rows) {
    const gate = Promise.withResolvers<number>();
    const first: [number, number] = [0, row[0]], second: [number, number] = [0, 80];
    const source: Source = { values: first, wait(): Promise<number> { log.push("wait"); return gate.promise; } };
    log.length = 0;
    const pending = update(source);
    Promise.resolve().then(() => { log.push("other"); first[1] = 100; source.values = second; gate.resolve(2); });
    const result = await pending;
    assert.compareArray(log, ["update", "wait", "other"]);
    assert.sameValue(result, row[1]);
    assert.sameValue(first[1], row[1]);
    assert.sameValue(second[1], 80);
    assert.sameValue(source.values, second);
  }
}
main().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
