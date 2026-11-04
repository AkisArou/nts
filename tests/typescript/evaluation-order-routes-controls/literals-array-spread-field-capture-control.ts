/*---
description: "Array elements capture a class field before and after a spread mutates it. The control evaluates the parts in separate statements."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-objects, ts-symbols, ts-spread, ts-unions, ts-null-undefined]
---*/
// A class field supplies a logged iterator; node captures the leading field value before the iterator and reads the trailing value after its done pull. The control names each ordered part.
const log: string[] = [];
class Holder { value: number = 0; stream: Iterable<number> = []; }
function read(holder: Holder, label: string): number { log.push(label); return holder.value; }
function build(holder: Holder): number[] {
  log.push("build");
  const before = read(holder, "before");
  const middle = [...holder.stream];
  const after = read(holder, "after");
  return [before, ...middle, after];
}
for (const input of [2, 9]) {
  log.length = 0; const holder = new Holder(); holder.value = input;
  holder.stream = { [Symbol.iterator](): Iterator<number, undefined> { log.push("iterator"); let index = 0; return {
    next(): IteratorResult<number, undefined> { log.push("next:" + index); if (index++ === 0) { holder.value += 10; return { done: false, value: holder.value }; } holder.value += 100; return { done: true, value: undefined }; }
  }; } };
  const result = build(holder);
  assert.compareArray(log, ["build", "before", "iterator", "next:0", "next:1", "after"]);
  assert.compareArray(result, [input, input + 10, input + 110]); assert.sameValue(holder.value, input + 110); assert.sameValue(result.length, 3);
}
