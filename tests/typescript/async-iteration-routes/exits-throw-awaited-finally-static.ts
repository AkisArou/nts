/*---
description: "A body throw waits for a static-field generator finally before reaching catch."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-generators, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-class, ts-class-fields, ts-static, ts-this, ts-instanceof]
flags: [async]
---*/
// A static source field carries the async generator; node completes the await in finally before the outside catch sees the original body URIError.
const log: string[] = [];
async function* produce(values: readonly number[], label: string): AsyncIterableIterator<number, undefined, unknown> {
  log.push(label + ":start");
  try { for (const value of values) { log.push(label + ":yield:" + String(value)); yield value; log.push(label + ":resume:" + String(value)); } log.push(label + ":end"); }
  finally { log.push(label + ":finally:before"); await Promise.resolve(); log.push(label + ":finally:after"); }
}
class Consumer {
  static source: AsyncIterable<number> = produce([], "unused");
  static async take(failure: Error, seen: number[]): Promise<void> { log.push("consume"); const source = this.source;
    for await (const value of source) { log.push("body:" + value); seen.push(value); throw failure; }
    log.push("after-loop");
  }
}
async function main(): Promise<void> {
  for (const items of [[2], [5, 7, 9]]) {
    const cursor = produce(items, "it"), seen: number[] = [], failure = new URIError("body"); let caught: unknown; Consumer.source = cursor;
    log.length = 0; try { await Consumer.take(failure, seen); } catch (error: unknown) { caught = error; log.push("caught"); } log.push("caller");
    assert.compareArray(log, ["consume", "it:start", "it:yield:" + items[0], "body:" + items[0], "it:finally:before", "it:finally:after", "caught", "caller"]);
    assert.compareArray(seen, items.slice(0, 1)); assert.sameValue(caught, failure); assert.sameValue(caught instanceof URIError, true); assert.sameValue(Consumer.source, cursor);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
