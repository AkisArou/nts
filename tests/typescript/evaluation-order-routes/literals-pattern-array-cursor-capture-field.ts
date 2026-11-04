/*---
description: "An array default can replace its carrier without replacing the active iterator."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-objects, ts-destructuring, ts-spread, ts-symbols, ts-unions, ts-null-undefined, ts-tuples]
---*/
// A class-held iterable enters a default and rest pattern; node keeps draining the original cursor after the default installs another source.
const log: string[] = [];
class Holder { source: Iterable<number | undefined> = []; }
function make(label: string, values: (number | undefined)[]): Iterable<number | undefined> { log.push("make:" + label); return { [Symbol.iterator](): Iterator<number | undefined, undefined> { log.push(label + ":iterator"); let index = 0; return { next(): IteratorResult<number | undefined, undefined> { log.push(label + ":next:" + index); if (index === values.length) return { done: true, value: undefined }; return { done: false, value: values[index++] }; } }; } }; }
function fallback(holder: Holder, input: number): number { log.push("default"); holder.source = make("replacement", [900]); return input + 10; }
function read(holder: Holder, input: number): [number, (number | undefined)[]] {
  log.push("read");
  const [first = fallback(holder, input), ...rest] = holder.source;
  return [first, rest];
}
for (const missing of [false, true]) for (const input of [1, 6]) {
  log.length = 0; const holder = new Holder(), source = make("original", [missing ? undefined : input, input + 1, input + 2]); holder.source = source;
  const result = read(holder, input);
  assert.compareArray(log, missing ? ["make:original", "read", "original:iterator", "original:next:0", "default", "make:replacement", "original:next:1", "original:next:2", "original:next:3"] : ["make:original", "read", "original:iterator", "original:next:0", "original:next:1", "original:next:2", "original:next:3"]);
  assert.sameValue(result[0], missing ? input + 10 : input); assert.compareArray(result[1], [input + 1, input + 2]); assert.sameValue(holder.source === source, !missing);
}
