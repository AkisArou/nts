/*---
description: "Control: Rejected await stops a binary expression at the suspended operand."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-suspensions, ts-async, ts-interfaces, ts-functions, ts-arrow-functions, ts-arrays, ts-tuples, ts-iteration, ts-numbers, ts-objects, ts-accessors, ts-errors, ts-unknown, ts-instanceof]
flags: [async]
---*/
// A rejected await in a binary expression through interface getters; node retains earlier effects and skips the remaining read and operation.
const log: string[] = [];
interface Source { readonly first: number; readonly task: Promise<number>; readonly last: number; }
async function run(source: Source): Promise<number> {
  log.push("run");
  const first = source.first;
  const task = source.task;
  const middle = await task;
  const partial = first + middle;
  const last = source.last;
  return partial + last;
}
async function main(): Promise<void> {
  log.push("main");
  for (const initial of [-2, 5]) {
    const gate = Promise.withResolvers<number>(), failure = new RangeError("operand");
    let current = initial;
    const source: Source = {
      get first(): number { log.push("first:" + current); return current++; },
      get task(): Promise<number> { log.push("task"); return gate.promise; },
      get last(): number { log.push("last"); current += 10; return current; }
    };
    log.length = 0;
    const pending = run(source);
    Promise.resolve().then(() => { log.push("reject"); gate.reject(failure); });
    let result: number | undefined, caught: unknown;
    try { result = await pending; } catch (error) { log.push("caught"); caught = error; }
    assert.compareArray(log, ["run", "first:" + initial, "task", "reject", "caught"]);
    assert.sameValue(caught, failure);
    assert.sameValue(caught instanceof RangeError, true);
    assert.sameValue(result, undefined);
    assert.sameValue(current, initial + 1);
  }
}
main().then($DONE, (error: unknown) => { log.push("failure"); $DONE(error instanceof Error ? error : new Error(String(error))); });
