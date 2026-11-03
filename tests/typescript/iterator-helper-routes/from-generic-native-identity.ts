/*---
description: Iterator.from retains native, generator and Iterator subclass objects by identity through a generic.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-generics]
---*/
// Iterator.from; generic IteratorObject parameter; node returns the same object without pulling.
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
function nativeSources(v: string[]): IteratorObject<string, undefined, unknown>[] {
  return [v.values(), new Map(v.map((x, k): [number, string] => [k, x])).values(), new Set(v).values(),
    generate(v), v.join("")[Symbol.iterator](), new Source(v.values(), [])];
}
function route<T extends View>(input: T): View { return Iterator.from(input); }
for (const values of [[], ["2"], ["1", "2", "3"]]) for (const input of nativeSources(values)) {
  const log: string[] = [], originalNext = input.next, originalReturn = input.return;
  input.next = () => { log.push("next"); return originalNext.call(input); };
  input.return = () => { log.push("return"); return originalReturn ? originalReturn.call(input) : { done: true, value: undefined }; };
  const result: View = route(input); assert.sameValue(result, input); assert.compareArray(log, []);
  assert.sameValue(result[Symbol.iterator](), result);
  for (let i = 0; i < values.length; i++) {
    const r = result.next(); assert.sameValue(r.done, false); assert.sameValue(r.value, values[i]);
    assert.compareArray(log, Array(i + 1).fill("next"));
  }
  const end = result.next(); assert.sameValue(end.done, true); assert.sameValue(end.value, undefined);
  assert.compareArray(log, Array(values.length + 1).fill("next"));
  if (!result.return) throw new Error("missing return"); const closed = result.return();
  assert.sameValue(closed.done, true); assert.sameValue(closed.value, undefined);
  const expected: string[] = Array(values.length + 1).fill("next"); expected.push("return"); assert.compareArray(log, expected);
}
