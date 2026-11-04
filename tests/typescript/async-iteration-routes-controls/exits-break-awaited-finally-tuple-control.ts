/*---
description: "Breaking a tuple-carried async generator awaits its finally before following code. The control uses explicit steps."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-tuples, ts-type-aliases, ts-objects, ts-this]
flags: [async]
---*/
// A tuple element carries the generator; node completes the await inside finally before after-loop and caller markers, with no resumed yield after break. The control spells out the same steps.
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
type Route = readonly [AsyncIterable<number>, string];
async function consume(route: Route): Promise<number[]> { log.push("consume"); const source = route[0], seen: number[] = [];
  const iterator = source[Symbol.asyncIterator]();
  while (true) { const step = await iterator.next(); if (step.done) break; const value = step.value; log.push("body:" + value); seen.push(value); const close = iterator.return; if (close !== undefined) await close.call(iterator); break; }
  log.push("after"); return seen;
}
async function main(): Promise<void> {
  for (const items of [[], [2], [5, 7, 9]]) {
    const cursor = produce(items, "it"), route: Route = [cursor, "kept"]; log.length = 0;
    const seen = await consume(route); log.push("caller"); const expected = ["consume", "it:start"];
    if (items.length > 0) expected.push("it:yield:" + items[0], "body:" + items[0]); else expected.push("it:end"); expected.push("it:finally:before", "it:finally:after", "after", "caller");
    assert.compareArray(log, expected); assert.compareArray(seen, items.slice(0, 1)); assert.sameValue(route[0], cursor); assert.sameValue(route[1], "kept");
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
