/*---
description: "A body throw waits for a static-field generator finally before reaching catch. The control uses explicit steps."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-symbols, ts-readonly, ts-errors, ts-null-undefined, ts-unions, ts-class, ts-class-fields, ts-static, ts-this, ts-instanceof, ts-objects]
flags: [async]
---*/
// A static source field carries the async generator; node completes the await in finally before the outside catch sees the original body URIError. The control spells out the same steps.
const log: string[] = [];
function produce(values: readonly number[], label: string): AsyncIterableIterator<number, undefined, unknown> {
  let index = 0, active = false, finished = false;
  const iterator: AsyncIterableIterator<number, undefined, unknown> = {
    [Symbol.asyncIterator](): AsyncIterableIterator<number, undefined, unknown> { return this; },
    async next(): Promise<IteratorResult<number, undefined>> {
      if (finished) return { done: true, value: undefined };
      if (active) log.push(label + ":resume:" + String(values[index - 1])); else { active = true; log.push(label + ":start"); }
      if (index < values.length) { const value = values[index++]; log.push(label + ":yield:" + String(value)); return { done: false, value }; }
      finished = true; log.push(label + ":end"); log.push(label + ":finally:before"); await Promise.resolve(); log.push(label + ":finally:after"); return { done: true, value: undefined };
    },
    async return(): Promise<IteratorResult<number, undefined>> { if (!finished) { finished = true; if (active) { log.push(label + ":finally:before"); await Promise.resolve(); log.push(label + ":finally:after"); } } return { done: true, value: undefined }; }
  }; return iterator;
}
class Consumer {
  static source: AsyncIterable<number> = produce([], "unused");
  static async take(failure: Error, seen: number[]): Promise<void> { log.push("consume"); const source = this.source;
    const iterator = source[Symbol.asyncIterator]();
  while (true) { const step = await iterator.next(); if (step.done) break; const value = step.value; try { log.push("body:" + value); seen.push(value); throw failure; } catch (error: unknown) { try { const close = iterator.return; if (close !== undefined) await close.call(iterator); } catch {} throw error; } }
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
