/*---
description: "A throwing nested iterator close prevents the next outer binding. The control evaluates the parts in separate statements."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-generics, ts-generic-constraints, ts-interfaces, ts-objects, ts-accessors, ts-symbols, ts-unions, ts-null-undefined, ts-errors]
---*/
// A generic interface carries a short nested pattern; node retains the close effect and skips the outer tail getter when return throws. The control names each ordered part.
const log: string[] = [];
interface Source { pair: Iterable<number>; after: number; }
let current = 0;
function read<T extends Source>(source: T): (number | undefined)[] {
  log.push("read");
  const sourcePart = source;
  const pairPart = sourcePart.pair;
  const open = pairPart[Symbol.iterator];
  const cursor = open.call(pairPart);
  const step = cursor.next();
  const first = step.done ? undefined : step.value;
  if (!step.done) { const close = cursor.return; if (close !== undefined) { const closed = close.call(cursor); } }
  const after = sourcePart.after;
  return [first, after];
}
for (const failure of [false, true]) for (const input of [2, 9]) {
  log.length = 0; current = input;
  const pair: Iterable<number> = { [Symbol.iterator](): Iterator<number, undefined> { log.push("iterator"); return {
    next(): IteratorResult<number, undefined> { log.push("next"); return { done: false, value: current }; },
    return(): IteratorResult<number, undefined> { log.push("return"); current += 100; if (failure) throw new RangeError("close"); return { done: true, value: undefined }; }
  }; } };
  const source: Source = { pair, get after(): number { log.push("get:after"); return ++current; } }; let output: (number | undefined)[] = [];
  function run(): void { log.push("run"); output = read(source); }
  if (failure) assert.throws(RangeError, run); else run();
  assert.compareArray(log, failure ? ["run", "read", "iterator", "next", "return"] : ["run", "read", "iterator", "next", "return", "get:after"]);
  assert.compareArray(output, failure ? [] : [input, input + 101]); assert.sameValue(current, failure ? input + 100 : input + 101);
}
