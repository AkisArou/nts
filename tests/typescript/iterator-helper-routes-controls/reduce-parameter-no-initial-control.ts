/*---
description: Reduce without an initial value starts callbacks at one and rejects an empty source.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-functions, ts-errors]
---*/
// reduce; declared source parameter; node returns the first value alone or throws TypeError on empty.
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
function route(input: View, f: (a: string, v: string, i: number) => string): string {
  const first = input.next(); if (first.done) throw new TypeError(); let a = first.value, i = 1;
  while (true) { const r = input.next(); if (r.done) return a; a = f(a, r.value, i++); }
}
for (const values of [[], ["2"], ["1", "2", "3"]]) for (const raw of sources(values)) {
  const log: string[] = [], input: View = new Source(raw, log);
  const callback = (a: string, v: string, i: number): string => { log.push("call:" + a + ":" + v + ":" + i); return a + v; };
  assert.compareArray(log, []);
  if (values.length === 0) { assert.throws(TypeError, () => route(input, callback)); assert.compareArray(log, ["next"]); }
  else {
    const got = route(input, callback); let wanted = values[0]; const expected = ["next"];
    for (let i = 1; i < values.length; i++) { expected.push("next", "call:" + wanted + ":" + values[i] + ":" + i); wanted += values[i]; }
    expected.push("next"); assert.sameValue(got, wanted); assert.compareArray(log, expected);
  }
}
