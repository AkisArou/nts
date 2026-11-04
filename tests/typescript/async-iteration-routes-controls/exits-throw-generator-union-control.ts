/*---
description: "A body throw closes a narrowed async generator before the outside catch. The control uses explicit steps."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-type-aliases, ts-discriminated-unions, ts-narrowing, ts-objects, ts-instanceof, ts-this]
flags: [async]
---*/
// Both arms of a declared union carry the generator; node runs its nonawaiting finally and preserves the consumer TypeError before the outside catch. The control spells out the same steps.
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
type Route = { kind: "direct"; source: AsyncIterable<number> } | { kind: "alternate"; other: AsyncIterable<number> };
async function consume(route: Route, failure: Error, seen: number[]): Promise<void> { log.push("consume:" + route.kind); const source = route.kind === "direct" ? route.source : route.other;
  const iterator = source[Symbol.asyncIterator]();
  while (true) { const step = await iterator.next(); if (step.done) break; const value = step.value; try { log.push("body:" + value); seen.push(value); throw failure; } catch (error: unknown) { try { const close = iterator.return; if (close !== undefined) await close.call(iterator); } catch {} throw error; } }
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
