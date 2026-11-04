/*---
description: "An enclosing return awaits a Map-held async generator finally before consumer cleanup. The control uses explicit steps."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-map-set, ts-typeof-operator, ts-objects, ts-this]
flags: [async]
---*/
// A checked Map value carries the generator; node completes its awaited finally before consumer finally and the caller receive the selected value. The control spells out the same steps.
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
async function consume(table: Map<string, AsyncIterable<number>>): Promise<number | undefined> {
  log.push("consume"); const source = table.get("active"); if (source === undefined) throw new Test262Error("missing source");
  try { const iterator = source[Symbol.asyncIterator](); while (true) { const step = await iterator.next(); if (step.done) break; const value = step.value; log.push("body:" + value); const result = value; const close = iterator.return; if (close !== undefined) await close.call(iterator); return result; } log.push("empty"); return undefined; }
  finally { log.push("consumer:finally"); }
}
async function main(): Promise<void> {
  for (const items of [[], [2], [5, 7, 9]]) {
    const cursor = produce(items, "it"), table = new Map<string, AsyncIterable<number>>([["active", cursor]]); log.length = 0;
    const value = await consume(table); log.push("caller"); const expected = ["consume", "it:start"];
    if (items.length > 0) expected.push("it:yield:" + items[0], "body:" + items[0]); else expected.push("it:end"); expected.push("it:finally:before", "it:finally:after"); if (items.length === 0) expected.push("empty"); expected.push("consumer:finally", "caller");
    assert.compareArray(log, expected); assert.sameValue(value, items[0]); assert.sameValue(typeof value, items.length > 0 ? "number" : "undefined"); assert.sameValue(table.get("active"), cursor);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
