/*---
description: "A body throw closes a narrowed async generator before the outside catch."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-generators, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-type-aliases, ts-discriminated-unions, ts-narrowing, ts-objects, ts-instanceof]
flags: [async]
---*/
// Both arms of a declared union carry the generator; node runs its nonawaiting finally and preserves the consumer TypeError before the outside catch.
const log: string[] = [];
async function* produce(values: readonly number[], label: string): AsyncIterableIterator<number, undefined, unknown> {
  log.push(label + ":start");
  try { for (const value of values) { log.push(label + ":yield:" + String(value)); yield value; log.push(label + ":resume:" + String(value)); } log.push(label + ":end"); }
  finally { log.push(label + ":finally"); }
}
type Route = { kind: "direct"; source: AsyncIterable<number> } | { kind: "alternate"; other: AsyncIterable<number> };
async function consume(route: Route, failure: Error, seen: number[]): Promise<void> { log.push("consume:" + route.kind); const source = route.kind === "direct" ? route.source : route.other;
  for await (const value of source) { log.push("body:" + value); seen.push(value); throw failure; }
  log.push("after-loop");
}
async function main(): Promise<void> {
  for (const items of [[2], [5, 7, 9]]) for (const alternate of [false, true]) {
    const cursor = produce(items, "it"), route: Route = alternate ? { kind: "alternate", other: cursor } : { kind: "direct", source: cursor }, seen: number[] = [], failure = new TypeError("body"); let caught: unknown;
    log.length = 0; try { await consume(route, failure, seen); } catch (error: unknown) { caught = error; log.push("caught"); } log.push("caller");
    assert.compareArray(log, ["consume:" + route.kind, "it:start", "it:yield:" + items[0], "body:" + items[0], "it:finally", "caught", "caller"]);
    assert.compareArray(seen, items.slice(0, 1)); assert.sameValue(caught, failure); assert.sameValue(caught instanceof TypeError, true);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
