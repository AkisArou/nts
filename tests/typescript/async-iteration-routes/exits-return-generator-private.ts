/*---
description: "An enclosing return closes a private-field async generator before consumer finally."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-generators, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-class, ts-class-fields, ts-this, ts-private-fields, ts-typeof-operator]
flags: [async]
---*/
// A private field carries the generator into a returning consumer; node runs generator finally, then consumer finally, then the caller with the saved value.
const log: string[] = [];
async function* produce(values: readonly number[], label: string): AsyncIterableIterator<number, undefined, unknown> {
  log.push(label + ":start");
  try { for (const value of values) { log.push(label + ":yield:" + String(value)); yield value; log.push(label + ":resume:" + String(value)); } log.push(label + ":end"); }
  finally { log.push(label + ":finally"); }
}
class Consumer {
  #source: AsyncIterable<number>; constructor(source: AsyncIterable<number>) { log.push("consumer:new"); this.#source = source; }
  async take(): Promise<number | undefined> { log.push("consume"); const source = this.#source;
    try { for await (const value of source) { log.push("body:" + value); return value; } log.push("empty"); return undefined; }
    finally { log.push("consumer:finally"); }
  }
}
async function main(): Promise<void> {
  for (const items of [[], [2], [5, 7, 9]]) {
    const consumer = new Consumer(produce(items, "it")); log.length = 0; const value = await consumer.take(); log.push("caller");
    const expected = ["consume", "it:start"]; if (items.length > 0) expected.push("it:yield:" + items[0], "body:" + items[0], "it:finally"); else expected.push("it:end", "it:finally", "empty"); expected.push("consumer:finally", "caller");
    assert.compareArray(log, expected); assert.sameValue(value, items[0]); assert.sameValue(typeof value, items.length > 0 ? "number" : "undefined");
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
