/*---
description: "Awaiting remainder retains the selected Map cell and old dividend."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-async, ts-interfaces, ts-functions, ts-arrow-functions, ts-arrays, ts-tuples, ts-iteration, ts-numbers, ts-objects, ts-map-set, ts-function-types, ts-errors]
flags: [async]
---*/
// %= through a Map value; node keeps the selected cell and old dividend while another task replaces the entry.
const log: string[] = [];
interface Cell { value: number; }
async function update(source: Map<string, Cell>, wait: () => Promise<number>): Promise<number> {
  log.push("update");
  const target = source.get("slot");
  if (target === undefined) throw new Error("missing slot");
  return target.value %= await wait();
}
async function main(): Promise<void> {
  log.push("main");
  const rows: [number, number][] = [[8, 2], [9, 0]];
  for (const row of rows) {
    const gate = Promise.withResolvers<number>();
    const first: Cell = { value: row[0] }, second: Cell = { value: 80 };
    const source: Map<string, Cell> = new Map([["slot", first]]);
    function wait(): Promise<number> { log.push("wait"); return gate.promise; }
    log.length = 0;
    const pending = update(source, wait);
    Promise.resolve().then(() => { log.push("other"); first.value = 100; source.set("slot", second); gate.resolve(3); });
    const result = await pending;
    assert.compareArray(log, ["update", "wait", "other"]);
    assert.sameValue(result, row[1]);
    assert.sameValue(first.value, row[1]);
    assert.sameValue(source.get("slot"), second);
    assert.sameValue(second.value, 80);
  }
}
main().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
