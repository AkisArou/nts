/*---
description: "An awaited generator-finally throw replaces break through a readonly source array. The control uses explicit steps."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-instanceof, ts-objects, ts-this]
flags: [async]
---*/
// A readonly array element carries the generator; node enters finally because of break, awaits it, and reports its RangeError instead of running following-loop code. The control spells out the same steps.
const log: string[] = [];
function produce(values: readonly number[], label: string, failure: Error): AsyncIterableIterator<number, undefined, unknown> {
  let index = 0, active = false, finished = false;
  const iterator: AsyncIterableIterator<number, undefined, unknown> = {
    [Symbol.asyncIterator](): AsyncIterableIterator<number, undefined, unknown> { return this; },
    async next(): Promise<IteratorResult<number, undefined>> {
      if (finished) return { done: true, value: undefined };
      if (active) log.push(label + ":resume:" + String(values[index - 1])); else { active = true; log.push(label + ":start"); }
      if (index < values.length) { const value = values[index++]; log.push(label + ":yield:" + String(value)); return { done: false, value }; }
      finished = true; log.push(label + ":end"); log.push(label + ":finally:before"); await Promise.resolve(); log.push(label + ":finally:throw"); throw failure;
    },
    async return(): Promise<IteratorResult<number, undefined>> { if (!finished) { finished = true; if (active) { log.push(label + ":finally:before"); await Promise.resolve(); log.push(label + ":finally:throw"); throw failure; } } return { done: true, value: undefined }; }
  }; return iterator;
}
async function consume(sources: readonly AsyncIterable<number>[], seen: number[]): Promise<void> { log.push("consume"); const source = sources[0];
  const iterator = source[Symbol.asyncIterator]();
  while (true) { const step = await iterator.next(); if (step.done) break; const value = step.value; log.push("body:" + value); seen.push(value); const close = iterator.return; if (close !== undefined) await close.call(iterator); break; }
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
