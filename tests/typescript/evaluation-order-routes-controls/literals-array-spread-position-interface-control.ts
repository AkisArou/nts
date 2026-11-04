/*---
description: "An array spread finishes at its position between effectful elements. The control evaluates the parts in separate statements."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-objects, ts-symbols, ts-spread, ts-unions, ts-null-undefined]
---*/
// An iterator crosses an interface field into an array literal; node evaluates the leading element, drains the spread, then reads the trailing state. The control names each ordered part.
const log: string[] = [];
interface Holder { values: Iterable<number>; }
let current = 0;
function edge(label: string): number { log.push(label); const value = current; current += 1; return value; }
function build(holder: Holder): number[] {
  log.push("build");
  const before = edge("before");
  const middle = [...holder.values];
  const after = edge("after");
  return [before, ...middle, after];
}
for (const count of [0, 2]) for (const input of [1, 7]) {
  log.length = 0; current = input;
  const holder: Holder = { values: { [Symbol.iterator](): Iterator<number, undefined> { log.push("iterator"); let index = 0; return {
    next(): IteratorResult<number, undefined> { log.push("next:" + index); if (index === count) return { done: true, value: undefined }; index++; const value = current; current += 10; return { done: false, value }; },
    return(): IteratorResult<number, undefined> { log.push("return"); return { done: true, value: undefined }; }
  }; } } };
  const result = build(holder), expectedLog = ["build", "before", "iterator"];
  for (let i = 0; i <= count; i++) expectedLog.push("next:" + i); expectedLog.push("after");
  assert.compareArray(log, expectedLog);
  const expected = [input]; for (let i = 0; i < count; i++) expected.push(input + 1 + i * 10); expected.push(input + 1 + count * 10);
  assert.compareArray(result, expected); assert.sameValue(current, input + 2 + count * 10); assert.sameValue(result.length, count + 2);
}
