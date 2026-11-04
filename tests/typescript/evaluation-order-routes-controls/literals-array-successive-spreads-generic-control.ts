/*---
description: "Successive array spreads select their iterable at each source position. The control evaluates the parts in separate statements."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-generics, ts-generic-constraints, ts-interfaces, ts-objects, ts-symbols, ts-spread, ts-unions, ts-null-undefined]
---*/
// A generic holder reaches two spread sites; node drains the first iterable before a middle call replaces the holder and the second site opens the replacement. The control names each ordered part.
const log: string[] = [];
interface Holder { source: Iterable<number>; }
let replacement: Iterable<number> = [];
function make(label: string, values: number[]): Iterable<number> { log.push("make:" + label); return { [Symbol.iterator](): Iterator<number, undefined> { log.push(label + ":iterator"); let index = 0; return { next(): IteratorResult<number, undefined> { log.push(label + ":next:" + index); if (index === values.length) return { done: true, value: undefined }; return { done: false, value: values[index++] }; } }; } }; }
function select(holder: Holder): Iterable<number> { log.push("select"); return holder.source; }
function replace(holder: Holder): number { log.push("replace"); holder.source = replacement; return 99; }
function build<T extends Holder>(holder: T): number[] {
  log.push("build");
  const first = [...select(holder)];
  const middle = replace(holder);
  const second = [...select(holder)];
  return [...first, middle, ...second];
}
for (const input of [3, 9]) {
  log.length = 0; const holder: Holder = { source: make("first", [input, input + 1]) }; replacement = make("second", [input + 10]);
  const result = build(holder);
  assert.compareArray(log, ["make:first", "make:second", "build", "select", "first:iterator", "first:next:0", "first:next:1", "first:next:2", "replace", "select", "second:iterator", "second:next:0", "second:next:1"]);
  assert.compareArray(result, [input, input + 1, 99, input + 10]); assert.sameValue(holder.source, replacement); assert.sameValue(result.length, 4);
}
