/*---
description: "A throwing array spread preserves earlier effects and skips later elements."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-tuples, ts-objects, ts-symbols, ts-spread, ts-unions, ts-null-undefined, ts-errors]
---*/
// An iterable crosses a tuple element into a literal; node retains prior pulls, skips the suffix and does not call return when next itself throws.
const log: string[] = [];
let current = 0;
function edge(label: string): number { log.push(label); return ++current; }
for (const failure of [false, true]) {
  log.length = 0; current = 0;
  const source: Iterable<number> = { [Symbol.iterator](): Iterator<number, undefined> { log.push("iterator"); let index = 0; return {
    next(): IteratorResult<number, undefined> { log.push("next:" + index); if (index === 2) return { done: true, value: undefined }; current += 10; if (index++ === 1 && failure) throw new RangeError("pull"); return { done: false, value: current }; },
    return(): IteratorResult<number, undefined> { log.push("return"); return { done: true, value: undefined }; }
  }; } };
  const route: [Iterable<number>] = [source]; let output: number[] = [];
  function run(): void {
    log.push("run");
    output = [edge("before"), ...route[0], edge("after")];
  }
  if (failure) assert.throws(RangeError, run); else run();
  assert.compareArray(log, failure ? ["run", "before", "iterator", "next:0", "next:1"] : ["run", "before", "iterator", "next:0", "next:1", "next:2", "after"]);
  assert.compareArray(output, failure ? [] : [1, 11, 21, 22]); assert.sameValue(current, failure ? 21 : 22);
}
