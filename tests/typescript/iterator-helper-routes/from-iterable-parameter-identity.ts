/*---
description: Iterator.from acquires an iterable once and retains its Iterator-derived iterator by identity.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-functions]
---*/
// Iterator.from; Iterable parameter; node calls the iterator method once but does not pull.
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
function route(input: Iterable<string>): Iterator<string, unknown, unknown> { return Iterator.from(input); }
for (const values of [[], ["2"], ["1", "2", "3"]]) for (const raw of sources(values)) {
  const log: string[] = [], input: View = new Source(raw, log);
  const iterable: Iterable<string> = { [Symbol.iterator]() { log.push("iterator"); return input; } };
  const result = route(iterable); assert.sameValue(result, input); assert.compareArray(log, ["iterator"]);
  const expected = ["iterator"];
  for (let i = 0; i < values.length; i++) {
    const r = result.next(); assert.sameValue(r.done, false); assert.sameValue(r.value, values[i]);
    expected.push("next"); assert.compareArray(log, expected);
  }
  const end = result.next(); assert.sameValue(end.done, true); assert.sameValue(end.value, undefined);
  expected.push("next"); assert.compareArray(log, expected);
}
