/*---
description: Two helper iterators in one typed array keep independent cursors and counters under interleaving.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-tuples]
---*/
// map helpers; View array; node preserves both suspended states when requests alternate.
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
for (const values of [[], ["2"], ["1", "2", "3"]]) for (const raw of sources(values)) {
  const logs: string[][] = [[], []], inputs: View[] = [new Source(raw, logs[0]), new Source(values.values(), logs[1])];
  const helpers: View[] = [];
  for (let k = 0; k < inputs.length; k++) {
    const callback = (v: string, i: number): string => { logs[k].push("map:" + v + ":" + i); return v + k; };
    helpers.push(inputs[k].map(callback));
  }
  assert.sameValue(helpers[0] === helpers[1], false); assert.compareArray(logs[0], []); assert.compareArray(logs[1], []);
  const expected: string[][] = [[], []];
  for (let i = 0; i <= values.length; i++) for (const k of [1, 0]) {
    const r = helpers[k].next(); assert.sameValue(r.done, i === values.length);
    assert.sameValue(r.value, i === values.length ? undefined : values[i] + k); expected[k].push("next");
    if (i < values.length) expected[k].push("map:" + values[i] + ":" + i);
    assert.compareArray(logs[0], expected[0]); assert.compareArray(logs[1], expected[1]);
  }
}
