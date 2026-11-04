/*---
description: "A consumer-body throw wins over an exit-triggered async generator finally throw."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-generators, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-type-aliases, ts-objects, ts-instanceof]
flags: [async]
---*/
// A declared object method consumes the generator; node runs its throwing finally during close but preserves the body TypeError over the cleanup SyntaxError.
const log: string[] = [];
async function* produce(values: readonly number[], label: string, failure: Error): AsyncIterableIterator<number, undefined, unknown> {
  log.push(label + ":start");
  try { for (const value of values) { log.push(label + ":yield:" + String(value)); yield value; log.push(label + ":resume:" + String(value)); } log.push(label + ":end"); }
  finally { log.push(label + ":finally:throw"); throw failure; }
}
type Consumer = { run(source: AsyncIterable<number>, failure: Error, seen: number[]): Promise<void> };
const consumer: Consumer = { async run(source: AsyncIterable<number>, failure: Error, seen: number[]): Promise<void> { log.push("consume");
  for await (const value of source) { log.push("body:" + value); seen.push(value); throw failure; }
  log.push("after-loop");
} };
async function main(): Promise<void> {
  for (const items of [[2], [5, 7, 9]]) {
    const bodyError = new TypeError("body"), finalError = new SyntaxError("finally"), source = produce(items, "it", finalError), seen: number[] = []; let caught: unknown;
    log.length = 0; try { await consumer.run(source, bodyError, seen); } catch (error: unknown) { caught = error; log.push("caught"); } log.push("caller");
    assert.compareArray(log, ["consume", "it:start", "it:yield:" + items[0], "body:" + items[0], "it:finally:throw", "caught", "caller"]);
    assert.compareArray(seen, items.slice(0, 1)); assert.sameValue(caught, bodyError); assert.sameValue(caught instanceof TypeError, true); assert.sameValue(caught === finalError, false);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
