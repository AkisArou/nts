/*---
description: "Continue resumes a generic async generator and delays finally until normal completion. The control uses explicit steps."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-generics, ts-generic-constraints, ts-objects, ts-this]
flags: [async]
---*/
// A generic consumer walks number and string generators; node resumes each continued yield, skips only that body tail, and runs finally after all values. The control spells out the same steps.
const log: string[] = [];
function produce<T extends number | string>(values: readonly T[], label: string): AsyncIterableIterator<T, undefined, unknown> {
  let index = 0, active = false, finished = false;
  const iterator: AsyncIterableIterator<T, undefined, unknown> = {
    [Symbol.asyncIterator](): AsyncIterableIterator<T, undefined, unknown> { return this; },
    async next(): Promise<IteratorResult<T, undefined>> {
      if (finished) return { done: true, value: undefined };
      if (active) log.push(label + ":resume:" + String(values[index - 1])); else { active = true; log.push(label + ":start"); }
      if (index < values.length) { const value = values[index++]; log.push(label + ":yield:" + String(value)); return { done: false, value }; }
      finished = true; log.push(label + ":end"); log.push(label + ":finally"); return { done: true, value: undefined };
    },
    async return(): Promise<IteratorResult<T, undefined>> { if (!finished) { finished = true; if (active) { log.push(label + ":finally"); } } return { done: true, value: undefined }; }
  }; return iterator;
}
async function consume<T extends number | string>(source: AsyncIterable<T>): Promise<T[]> { log.push("consume"); const seen: T[] = []; let index = 0;
  const iterator = source[Symbol.asyncIterator]();
  while (true) { const step = await iterator.next(); if (step.done) break; const value = step.value; log.push("body:" + String(value)); seen.push(value); if (index++ % 2 === 0) { log.push("continue"); continue; } log.push("tail"); }
  log.push("after"); return seen;
}
async function check<T extends number | string>(items: readonly T[]): Promise<void> {
  const source = produce<T>(items, "it"); log.length = 0; const seen = await consume<T>(source); log.push("caller"); const expected = ["consume", "it:start"];
  for (let index = 0; index < items.length; index++) { if (index > 0) expected.push("it:resume:" + String(items[index - 1])); expected.push("it:yield:" + String(items[index]), "body:" + String(items[index]), index % 2 === 0 ? "continue" : "tail"); }
  if (items.length > 0) expected.push("it:resume:" + String(items[items.length - 1])); expected.push("it:end", "it:finally", "after", "caller");
  assert.compareArray(log, expected); assert.compareArray(seen, items);
}
async function main(): Promise<void> { await check<number>([]); await check<number>([2, 4, 6]); await check<string>([]); await check<string>(["a", "b", "c"]); }
main().then(() => $DONE(), (error: unknown) => $DONE(error));
