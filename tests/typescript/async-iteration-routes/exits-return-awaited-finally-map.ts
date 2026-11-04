/*---
description: "An enclosing return awaits a Map-held async generator finally before consumer cleanup."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-generators, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-map-set, ts-typeof-operator]
flags: [async]
---*/
// A checked Map value carries the generator; node completes its awaited finally before consumer finally and the caller receive the selected value.
const log: string[] = [];
async function* produce(values: readonly number[], label: string): AsyncIterableIterator<number, undefined, unknown> {
  log.push(label + ":start");
  try { for (const value of values) { log.push(label + ":yield:" + String(value)); yield value; log.push(label + ":resume:" + String(value)); } log.push(label + ":end"); }
  finally { log.push(label + ":finally:before"); await Promise.resolve(); log.push(label + ":finally:after"); }
}
async function consume(table: Map<string, AsyncIterable<number>>): Promise<number | undefined> {
  log.push("consume"); const source = table.get("active"); if (source === undefined) throw new Test262Error("missing source");
  try { for await (const value of source) { log.push("body:" + value); return value; } log.push("empty"); return undefined; }
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
