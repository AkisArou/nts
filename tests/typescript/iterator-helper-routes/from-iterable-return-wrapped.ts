/*---
description: An iterable whose own iterator is plain still receives an Iterator.from wrapper.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-functions]
---*/
// Iterator.from; Iterable parameter and IteratorObject return; node wraps the acquired plain iterator.
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
function route(input: Iterable<string>): IteratorObject<string, unknown, unknown> { return Iterator.from(input); }
for (const values of [[], ["2"], ["1", "2", "3"]]) for (const raw of sources(values)) {
  const log: string[] = [], input: Iterator<string, unknown, unknown> = {
    next() { log.push("next"); return raw.next(); },
    return() { log.push("return"); raw.return?.(); return { done: true, value: undefined }; }
  };
  const iterable: Iterable<string> = { [Symbol.iterator]() { log.push("iterator"); return input; } };
  const result = route(iterable); assert.sameValue(result === input, false);
  assert.sameValue(result[Symbol.iterator](), result); assert.compareArray(log, ["iterator"]);
  const r = result.next(); assert.sameValue(r.done, values.length === 0); assert.sameValue(r.value, values[0]);
  assert.compareArray(log, ["iterator", "next"]); if (!result.return) throw new Error("missing wrapper return");
  const end = result.return(); assert.sameValue(end.done, true); assert.sameValue(end.value, undefined);
  assert.compareArray(log, ["iterator", "next", "return"]);
}
