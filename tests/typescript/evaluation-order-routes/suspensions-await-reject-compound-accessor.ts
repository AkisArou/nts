/*---
description: "Rejected await preserves target effects and forbids the compound write."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-async, ts-interfaces, ts-functions, ts-arrow-functions, ts-arrays, ts-tuples, ts-iteration, ts-numbers, ts-objects, ts-accessors, ts-errors, ts-unknown, ts-instanceof]
flags: [async]
---*/
// Rejected += through an interface accessor; node retains the pre-await getter effect and never performs the compound setter.
const log: string[] = [];
interface Cell { raw: number; value: number; }
interface Source { cell: Cell; readonly task: Promise<number>; }
async function update(source: Source): Promise<number> {
  log.push("update");
  return source.cell.value += await source.task;
}
async function main(): Promise<void> {
  log.push("main");
  for (const initial of [-2, 5]) {
    const gate = Promise.withResolvers<number>(), failure = new SyntaxError("operand");
    const first: Cell = { raw: initial, get value(): number { log.push("get:" + this.raw); return this.raw; }, set value(value: number) { log.push("set:" + value); this.raw = value; } };
    const second: Cell = { raw: 80, value: 80 };
    const source: Source = { cell: first, get task(): Promise<number> { log.push("task"); return gate.promise; } };
    log.length = 0;
    const pending = update(source);
    Promise.resolve().then(() => { log.push("reject"); first.raw = 100; source.cell = second; gate.reject(failure); });
    let result: number | undefined, caught: unknown;
    try { result = await pending; } catch (error) { log.push("caught"); caught = error; }
    assert.compareArray(log, ["update", "get:" + initial, "task", "reject", "caught"]);
    assert.sameValue(caught, failure);
    assert.sameValue(caught instanceof SyntaxError, true);
    assert.sameValue(result, undefined);
    assert.sameValue(first.raw, 100);
    assert.sameValue(second.raw, 80);
    assert.sameValue(source.cell, second);
  }
}
main().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
