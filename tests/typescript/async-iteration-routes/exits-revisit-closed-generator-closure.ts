/*---
description: "A second loop over a captured async generator closed by break performs no body steps."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-generators, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-closures]
flags: [async]
---*/
// A captured let carries the same generator to two loops; node completes awaited closing once, and the second loop neither resumes nor restarts its body.
const log: string[] = [];
async function* produce(values: readonly number[], label: string): AsyncIterableIterator<number, undefined, unknown> {
  log.push(label + ":start");
  try { for (const value of values) { log.push(label + ":yield:" + String(value)); yield value; log.push(label + ":resume:" + String(value)); } log.push(label + ":end"); }
  finally { log.push(label + ":finally:before"); await Promise.resolve(); log.push(label + ":finally:after"); }
}
let selected: AsyncIterable<number> = produce([], "unused");
async function consume(limit: number): Promise<number[][]> { log.push("consume"); const source = selected, first: number[] = [], second: number[] = [];
  for await (const value of source) { log.push("first:" + value); first.push(value); if (first.length === limit) break; }
  log.push("between");
  for await (const value of source) { log.push("second:" + value); second.push(value); }
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
