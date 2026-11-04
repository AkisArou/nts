/*---
description: "Nested async closing preserves the inner close error while still awaiting the outer close. The control uses explicit steps."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this, ts-symbols, ts-readonly, ts-generics, ts-null-undefined, ts-unions, ts-errors, ts-objects, ts-tuples, ts-generic-constraints, ts-instanceof, ts-typeof-operator]
flags: [async]
---*/
// A generic consumer walks number and string sources; node closes inner before outer, preserves an inner RangeError over an outer SyntaxError, and otherwise reports the outer error. The control spells out the same steps.
const log: string[] = [];
class Source<T> implements AsyncIterableIterator<T, undefined, unknown> {
  items: readonly T[]; name: string; index: number = 0; closed: number = 0; fault: Error | undefined;
  constructor(items: readonly T[], name: string = "it", fault?: Error) { log.push("new:" + name); this.items = items; this.name = name; this.fault = fault; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, undefined, unknown> { log.push(this.name + ":iterator"); return this; }
  async next(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":next:" + this.index); return this.closed || this.index === this.items.length ? { done: true, value: undefined } : { done: false, value: this.items[this.index++] }; }
  async return(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":return:start"); this.closed++; await Promise.resolve(); if (this.fault !== undefined) { log.push(this.name + ":return:reject"); throw this.fault; } log.push(this.name + ":return:end"); return { done: true, value: undefined }; }
}
async function consume<T extends number | string>(route: readonly [AsyncIterable<T>, AsyncIterable<T>], seen: T[]): Promise<void> { log.push("consume");
  const outerIterator = route[0][Symbol.asyncIterator]();
  outer: while (true) { const step = await outerIterator.next(); if (step.done) break; const left = step.value; log.push("outer:body:" + String(left));
    const innerIterator = route[1][Symbol.asyncIterator]();
    while (true) { const step = await innerIterator.next(); if (step.done) break; const right = step.value; log.push("inner:body:" + String(right)); seen.push(left, right);
      try { const close = innerIterator.return; if (close !== undefined) await close.call(innerIterator); }
      catch (error: unknown) { try { const close = outerIterator.return; if (close !== undefined) await close.call(outerIterator); } catch {} throw error; }
      const close = outerIterator.return; if (close !== undefined) await close.call(outerIterator); break outer;
    }
    log.push("outer:tail");
  }
  log.push("after-loop");
}
async function check<T extends number | string>(items: readonly T[], kind: string): Promise<void> {
  const configurations: readonly [boolean, boolean][] = [[true, false], [false, true], [true, true]];
  for (const configuration of configurations) {
    const failInner = configuration[0], failOuter = configuration[1], innerFailure = new RangeError("inner"), outerFailure = new SyntaxError("outer");
    const outer = new Source(items, "outer", failOuter ? outerFailure : undefined), inner = new Source(items, "inner", failInner ? innerFailure : undefined), seen: T[] = []; let caught: unknown;
    log.length = 0; try { await consume<T>([outer, inner], seen); } catch (error: unknown) { caught = error; log.push("caught"); } log.push("caller");
    assert.compareArray(log, ["consume", "outer:iterator", "outer:next:0", "outer:body:" + String(items[0]), "inner:iterator", "inner:next:0", "inner:body:" + String(items[0]), "inner:return:start", failInner ? "inner:return:reject" : "inner:return:end", "outer:return:start", failOuter ? "outer:return:reject" : "outer:return:end", "caught", "caller"]);
    assert.compareArray(seen, [items[0], items[0]]); assert.sameValue(typeof seen[0], kind); assert.sameValue(caught, failInner ? innerFailure : outerFailure);
    assert.sameValue(caught instanceof RangeError, failInner); assert.sameValue(caught instanceof SyntaxError, !failInner);
    assert.sameValue(outer.closed, 1); assert.sameValue(inner.closed, 1); assert.sameValue(outer.index, 1); assert.sameValue(inner.index, 1);
  }
}
async function main(): Promise<void> { await check<number>([2, 3], "number"); await check<string>(["a", "b"], "string"); }
main().then(() => $DONE(), (error: unknown) => $DONE(error));
