/*---
description: "Compound addition retains one getter result and its original setter across await."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-async, ts-interfaces, ts-functions, ts-arrow-functions, ts-arrays, ts-tuples, ts-iteration, ts-numbers, ts-objects, ts-accessors]
flags: [async]
---*/
// += through interface accessors; node gets once before await and sets the original receiver after another task retargets the holder.
const log: string[] = [];
interface Cell { raw: number; value: number; }
interface Source { cell: Cell; wait(): Promise<number>; }
async function update(source: Source): Promise<number> {
  log.push("update");
  return source.cell.value += await source.wait();
}
async function main(): Promise<void> {
  log.push("main");
  for (const initial of [-2, 5]) {
    const gate = Promise.withResolvers<number>();
    const first: Cell = { raw: initial, get value(): number { log.push("get:" + this.raw); return this.raw; }, set value(value: number) { log.push("set:" + value); this.raw = value; } };
    const second: Cell = { raw: 80, value: 80 };
    const source: Source = { cell: first, wait(): Promise<number> { log.push("wait"); return gate.promise; } };
    log.length = 0;
    const pending = update(source);
    Promise.resolve().then(() => { log.push("other"); first.value = 100; source.cell = second; gate.resolve(2); });
    const result = await pending;
    assert.compareArray(log, ["update", "get:" + initial, "wait", "other", "set:100", "set:" + (initial + 2)]);
    assert.sameValue(result, initial + 2);
    assert.sameValue(first.raw, initial + 2);
    assert.sameValue(second.raw, 80);
    assert.sameValue(source.cell, second);
  }
}
main().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
