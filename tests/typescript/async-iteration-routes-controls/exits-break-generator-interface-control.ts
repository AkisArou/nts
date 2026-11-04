/*---
description: "An interface-produced async generator runs nonawaiting finally before the code after break. The control uses explicit steps."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-class, ts-class-fields, ts-this, ts-interfaces, ts-objects]
flags: [async]
---*/
// Two factory implementations return the async generator through one interface; node runs its finally once before after-loop code and never resumes a broken yield. The control spells out the same steps.
const log: string[] = [];
function produce(values: readonly number[], label: string): AsyncIterableIterator<number, undefined, unknown> {
  let index = 0, active = false, finished = false;
  const iterator: AsyncIterableIterator<number, undefined, unknown> = {
    [Symbol.asyncIterator](): AsyncIterableIterator<number, undefined, unknown> { return this; },
    async next(): Promise<IteratorResult<number, undefined>> {
      if (finished) return { done: true, value: undefined };
      if (active) log.push(label + ":resume:" + String(values[index - 1])); else { active = true; log.push(label + ":start"); }
      if (index < values.length) { const value = values[index++]; log.push(label + ":yield:" + String(value)); return { done: false, value }; }
      finished = true; log.push(label + ":end"); log.push(label + ":finally"); return { done: true, value: undefined };
    },
    async return(): Promise<IteratorResult<number, undefined>> { if (!finished) { finished = true; if (active) { log.push(label + ":finally"); } } return { done: true, value: undefined }; }
  }; return iterator;
}
interface Factory { label: string; open(items: readonly number[]): AsyncIterable<number>; }
class First implements Factory { label: string = "first"; open(items: readonly number[]): AsyncIterable<number> { log.push("open:first"); return produce(items, this.label); } }
class Second implements Factory { label: string = "second"; open(items: readonly number[]): AsyncIterable<number> { log.push("open:second"); return produce(items, this.label); } }
async function consume(factory: Factory, items: readonly number[]): Promise<number[]> { log.push("consume"); const source = factory.open(items), seen: number[] = [];
  const iterator = source[Symbol.asyncIterator]();
  while (true) { const step = await iterator.next(); if (step.done) break; const value = step.value; log.push("body:" + value); seen.push(value); const close = iterator.return; if (close !== undefined) await close.call(iterator); break; }
  log.push("after"); return seen;
}
async function main(): Promise<void> {
  const factories: Factory[] = [new First(), new Second()];
  for (const factory of factories) for (const items of [[], [2], [5, 7, 9]]) {
    log.length = 0; const seen = await consume(factory, items); log.push("caller"); const label = factory.label, expected = ["consume", "open:" + label, label + ":start"];
    if (items.length > 0) expected.push(label + ":yield:" + items[0], "body:" + items[0]); else expected.push(label + ":end"); expected.push(label + ":finally", "after", "caller");
    assert.compareArray(log, expected); assert.compareArray(seen, items.slice(0, 1));
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
