/*---
description: "A labeled break closes nested tuple-carried async iterators inner before outer. The control uses explicit steps."
features: [ts-async-iteration-routes, ts-async-iteration-route-exits, ts-async, ts-async-generators, ts-iteration, ts-functions, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this, ts-symbols, ts-readonly, ts-generics, ts-null-undefined, ts-unions, ts-errors, ts-objects, ts-tuples, ts-type-aliases]
flags: [async]
---*/
// A declared tuple carries number and string sources; node awaits the entire inner return before starting outer return, then runs after-loop code. The control spells out the same steps.
const log: string[] = [];
class Source<T> implements AsyncIterableIterator<T, undefined, unknown> {
  items: readonly T[]; name: string; index: number = 0; closed: number = 0; fault: Error | undefined;
  constructor(items: readonly T[], name: string = "it", fault?: Error) { log.push("new:" + name); this.items = items; this.name = name; this.fault = fault; }
  [Symbol.asyncIterator](): AsyncIterableIterator<T, undefined, unknown> { log.push(this.name + ":iterator"); return this; }
  async next(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":next:" + this.index); return this.closed || this.index === this.items.length ? { done: true, value: undefined } : { done: false, value: this.items[this.index++] }; }
  async return(): Promise<IteratorResult<T, undefined>> { log.push(this.name + ":return:start"); this.closed++; await Promise.resolve(); if (this.fault !== undefined) { log.push(this.name + ":return:reject"); throw this.fault; } log.push(this.name + ":return:end"); return { done: true, value: undefined }; }
}
type Route = readonly [AsyncIterable<number>, AsyncIterable<string>];
async function consume(route: Route): Promise<string[]> { log.push("consume"); const seen: string[] = [];
  const outerIterator = route[0][Symbol.asyncIterator]();
  outer: while (true) { const step = await outerIterator.next(); if (step.done) break; const left = step.value; log.push("outer:body:" + left);
    const innerIterator = route[1][Symbol.asyncIterator]();
    while (true) { const step = await innerIterator.next(); if (step.done) break; const right = step.value; log.push("inner:body:" + right); seen.push(left + ":" + right);
      const innerClose = innerIterator.return; if (innerClose !== undefined) await innerClose.call(innerIterator);
      const outerClose = outerIterator.return; if (outerClose !== undefined) await outerClose.call(outerIterator); break outer;
    }
    log.push("outer:tail");
  }
  log.push("after"); return seen;
}
async function main(): Promise<void> {
  for (const numbers of [[2], [5, 7]]) for (const words of [["a"], ["x", "y"]]) {
    const outer = new Source(numbers, "outer"), inner = new Source(words, "inner"), route: Route = [outer, inner]; log.length = 0;
    const seen = await consume(route); log.push("caller");
    assert.compareArray(log, ["consume", "outer:iterator", "outer:next:0", "outer:body:" + numbers[0], "inner:iterator", "inner:next:0", "inner:body:" + words[0], "inner:return:start", "inner:return:end", "outer:return:start", "outer:return:end", "after", "caller"]);
    assert.compareArray(seen, [numbers[0] + ":" + words[0]]); assert.sameValue(outer.closed, 1); assert.sameValue(inner.closed, 1);
    assert.sameValue(outer.index, 1); assert.sameValue(inner.index, 1); assert.sameValue(route[0], outer); assert.sameValue(route[1], inner);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
