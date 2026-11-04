/*---
description: "An awaited generator-finally throw replaces break through a readonly source array."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-generators, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-instanceof]
flags: [async]
---*/
// A readonly array element carries the generator; node enters finally because of break, awaits it, and reports its RangeError instead of running following-loop code.
const log: string[] = [];
async function* produce(values: readonly number[], label: string, failure: Error): AsyncIterableIterator<number, undefined, unknown> {
  log.push(label + ":start");
  try { for (const value of values) { log.push(label + ":yield:" + String(value)); yield value; log.push(label + ":resume:" + String(value)); } log.push(label + ":end"); }
  finally { log.push(label + ":finally:before"); await Promise.resolve(); log.push(label + ":finally:throw"); throw failure; }
}
async function consume(sources: readonly AsyncIterable<number>[], seen: number[]): Promise<void> { log.push("consume"); const source = sources[0];
  for await (const value of source) { log.push("body:" + value); seen.push(value); break; }
  log.push("after-loop");
}
async function main(): Promise<void> {
  for (const items of [[2], [5, 7, 9]]) {
    const failure = new RangeError("finally"), sources: readonly AsyncIterable<number>[] = [produce(items, "it", failure)], seen: number[] = []; let caught: unknown;
    log.length = 0; try { await consume(sources, seen); } catch (error: unknown) { caught = error; log.push("caught"); } log.push("caller");
    assert.compareArray(log, ["consume", "it:start", "it:yield:" + items[0], "body:" + items[0], "it:finally:before", "it:finally:throw", "caught", "caller"]);
    assert.compareArray(seen, items.slice(0, 1)); assert.sameValue(caught, failure); assert.sameValue(caught instanceof RangeError, true);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
