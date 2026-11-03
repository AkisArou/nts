/*---
description: Reduce through a generic helper uses its initial accumulator even for empty sources.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-generics]
---*/
// reduce; generic source parameter; node returns seed plus the values with callback indices from zero.
type Step = IteratorResult<string, undefined>;
type View = IteratorObject<string, undefined, unknown>;
class Source extends Iterator<string, undefined, unknown> {
  input: Iterator<string, unknown, unknown>; log: string[];
  constructor(input: Iterator<string, unknown, unknown>, log: string[]) { super(); this.input = input; this.log = log; }
  next(): Step { this.log.push("next"); const r = this.input.next(); return r.done ? { done: true, value: undefined } : { done: false, value: r.value }; }
  return(): Step { this.log.push("return"); this.input.return?.(); return { done: true, value: undefined }; }
}
function* generate(v: string[]): Generator<string, undefined, unknown> { for (const x of v) yield x; return undefined; }
function sources(v: string[]): Iterator<string, unknown, unknown>[] {
  let i = 0;
  const plain: Iterator<string, undefined, unknown> = { next: () => i < v.length ? { done: false, value: v[i++] } : { done: true, value: undefined } };
  return [v.values(), new Map(v.map((x, k): [number, string] => [k, x])).values(), new Set(v).values(),
    generate(v), v.join("")[Symbol.iterator](), plain, new Source(v.values(), [])];
}
function route<T>(input: IteratorObject<T, undefined, unknown>, f: (a: string, v: T, i: number) => string): string {
  let a = "seed", i = 0; while (true) { const r = input.next(); if (r.done) return a; a = f(a, r.value, i++); }
}
for (const values of [[], ["2"], ["1", "2", "3"]]) for (const raw of sources(values)) {
  const log: string[] = [], input: View = new Source(raw, log);
  const callback = (a: string, v: string, i: number): string => { log.push("call:" + a + ":" + v + ":" + i); return a + v; };
  assert.compareArray(log, []); const got = route(input, callback);
  let wanted = "seed"; const expected: string[] = [];
  for (let i = 0; i < values.length; i++) { expected.push("next", "call:" + wanted + ":" + values[i] + ":" + i); wanted += values[i]; }
  expected.push("next"); assert.sameValue(got, wanted); assert.compareArray(log, expected);
}
