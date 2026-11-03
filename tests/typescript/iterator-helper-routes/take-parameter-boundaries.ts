/*---
description: Take limits preserve lazy per-step pulls and close only on the next request after the final yield.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-functions]
---*/
// take; View parameter; node yields the prefix and closes on resumption, including zero.
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
function route(input: View, limit: number): View { return input.take(limit); }
for (const values of [[], ["2"], ["1", "2", "3"]]) for (const limit of [0, -0, -0.5, 0.9, 1, 1.9, 2, 3, 4, Infinity]) {
  for (const raw of sources(values)) {
    const log: string[] = [], input: View = new Source(raw, log), helper: View = route(input, limit);
    const count = Math.min(values.length, Math.trunc(limit)); assert.compareArray(log, []);
    for (let i = 0; i < count; i++) {
      const r = helper.next(); assert.sameValue(r.done, false); assert.sameValue(r.value, values[i]);
      assert.compareArray(log, Array(i + 1).fill("next"));
    }
    const end = helper.next(); assert.sameValue(end.done, true); assert.sameValue(end.value, undefined);
    const expected: string[] = Array(count).fill("next"); expected.push(Math.trunc(limit) <= values.length ? "return" : "next");
    assert.compareArray(log, expected);
    const again = helper.next(); assert.sameValue(again.done, true); assert.sameValue(again.value, undefined);
    if (!helper.return) throw new Error("missing helper return");
    const closed = helper.return(); assert.sameValue(closed.done, true); assert.sameValue(closed.value, undefined);
    assert.compareArray(log, expected);
  }
}
