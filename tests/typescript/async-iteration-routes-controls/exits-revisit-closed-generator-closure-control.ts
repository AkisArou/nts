/*---
description: "A second loop over a captured async generator closed by break performs no body steps. The control uses explicit steps."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-closures, ts-objects, ts-this]
flags: [async]
---*/
// A captured let carries the same generator to two loops; node completes awaited closing once, and the second loop neither resumes nor restarts its body. The control spells out the same steps.
const log: string[] = [];
function produce(values: readonly number[], label: string): AsyncIterableIterator<number, undefined, unknown> {
  let index = 0, active = false, finished = false;
  const iterator: AsyncIterableIterator<number, undefined, unknown> = {
    [Symbol.asyncIterator](): AsyncIterableIterator<number, undefined, unknown> { return this; },
    async next(): Promise<IteratorResult<number, undefined>> {
      if (finished) return { done: true, value: undefined };
      if (active) log.push(label + ":resume:" + String(values[index - 1])); else { active = true; log.push(label + ":start"); }
      if (index < values.length) { const value = values[index++]; log.push(label + ":yield:" + String(value)); return { done: false, value }; }
      finished = true; log.push(label + ":end"); log.push(label + ":finally:before"); await Promise.resolve(); log.push(label + ":finally:after"); return { done: true, value: undefined };
    },
    async return(): Promise<IteratorResult<number, undefined>> { if (!finished) { finished = true; if (active) { log.push(label + ":finally:before"); await Promise.resolve(); log.push(label + ":finally:after"); } } return { done: true, value: undefined }; }
  }; return iterator;
}
let selected: AsyncIterable<number> = produce([], "unused");
async function consume(limit: number): Promise<number[][]> { log.push("consume"); const source = selected, first: number[] = [], second: number[] = [];
  const firstIterator = source[Symbol.asyncIterator]();
  while (true) { const step = await firstIterator.next(); if (step.done) break; const value = step.value; log.push("first:" + value); first.push(value); if (first.length === limit) { const close = firstIterator.return; if (close !== undefined) await close.call(firstIterator); break; } }
  log.push("between");
  const secondIterator = source[Symbol.asyncIterator]();
  while (true) { const step = await secondIterator.next(); if (step.done) break; const value = step.value; log.push("second:" + value); second.push(value); }
  log.push("after"); return [first, second];
}
async function main(): Promise<void> {
  for (const items of [[2, 3], [5, 7, 9]]) for (const limit of [1, 2]) {
    selected = produce(items, "it"); log.length = 0; const seen = await consume(limit); log.push("caller"); const expected = ["consume", "it:start"];
    for (let index = 0; index < limit; index++) { if (index > 0) expected.push("it:resume:" + items[index - 1]); expected.push("it:yield:" + items[index], "first:" + items[index]); }
    expected.push("it:finally:before", "it:finally:after", "between", "after", "caller");
    assert.compareArray(log, expected); assert.compareArray(seen[0], items.slice(0, limit)); assert.compareArray(seen[1], []);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
