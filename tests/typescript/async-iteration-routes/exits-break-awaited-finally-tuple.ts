/*---
description: "Breaking a tuple-carried async generator awaits its finally before following code."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-generators, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-tuples, ts-type-aliases]
flags: [async]
---*/
// A tuple element carries the generator; node completes the await inside finally before after-loop and caller markers, with no resumed yield after break.
const log: string[] = [];
async function* produce(values: readonly number[], label: string): AsyncIterableIterator<number, undefined, unknown> {
  log.push(label + ":start");
  try { for (const value of values) { log.push(label + ":yield:" + String(value)); yield value; log.push(label + ":resume:" + String(value)); } log.push(label + ":end"); }
  finally { log.push(label + ":finally:before"); await Promise.resolve(); log.push(label + ":finally:after"); }
}
type Route = readonly [AsyncIterable<number>, string];
async function consume(route: Route): Promise<number[]> { log.push("consume"); const source = route[0], seen: number[] = [];
  for await (const value of source) { log.push("body:" + value); seen.push(value); break; }
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
