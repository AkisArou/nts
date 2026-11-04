/*---
description: "An interface-produced async generator runs nonawaiting finally before the code after break."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-generators, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-class, ts-class-fields, ts-this, ts-interfaces]
flags: [async]
---*/
// Two factory implementations return the async generator through one interface; node runs its finally once before after-loop code and never resumes a broken yield.
const log: string[] = [];
async function* produce(values: readonly number[], label: string): AsyncIterableIterator<number, undefined, unknown> {
  log.push(label + ":start");
  try { for (const value of values) { log.push(label + ":yield:" + String(value)); yield value; log.push(label + ":resume:" + String(value)); } log.push(label + ":end"); }
  finally { log.push(label + ":finally"); }
}
interface Factory { label: string; open(items: readonly number[]): AsyncIterable<number>; }
class First implements Factory { label: string = "first"; open(items: readonly number[]): AsyncIterable<number> { log.push("open:first"); return produce(items, this.label); } }
class Second implements Factory { label: string = "second"; open(items: readonly number[]): AsyncIterable<number> { log.push("open:second"); return produce(items, this.label); } }
async function consume(factory: Factory, items: readonly number[]): Promise<number[]> { log.push("consume"); const source = factory.open(items), seen: number[] = [];
  for await (const value of source) { log.push("body:" + value); seen.push(value); break; }
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
