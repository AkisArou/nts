/*---
description: Take rejects negative integer and NaN limits at construction before a source pull.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-interfaces, ts-errors]
---*/
// take; interface fields; node throws RangeError eagerly and leaves the source untouched.
type Step = IteratorResult<string, undefined>;
type View = IteratorObject<string, undefined, unknown>;
class Source extends Iterator<string, undefined, unknown> {
  input: Iterator<string, unknown, unknown>; log: string[];
  constructor(input: Iterator<string, unknown, unknown>, log: string[]) { super(); this.input = input; this.log = log; }
  next(): Step { this.log.push("next"); const r = this.input.next(); return r.done ? { done: true, value: undefined } : { done: false, value: r.value }; }
}
function* generate(v: string[]): Generator<string, undefined, unknown> { for (const x of v) yield x; return undefined; }
function sources(v: string[]): Iterator<string, unknown, unknown>[] {
  let i = 0;
  const plain: Iterator<string, undefined, unknown> = { next: () => i < v.length ? { done: false, value: v[i++] } : { done: true, value: undefined } };
  return [v.values(), new Map(v.map((x, k): [number, string] => [k, x])).values(), new Set(v).values(),
    generate(v), v.join("")[Symbol.iterator](), plain, new Source(v.values(), [])];
}
function route(slot: Slot): View {
  const count = Math.trunc(slot.limit); if (Number.isNaN(count) || count < 0) throw new RangeError();
  throw new Error("invalid-limit fixture required");
}
interface Slot { input: View; limit: number }
for (const values of [[], ["2"], ["1", "2", "3"]]) for (const limit of [-1, -1.9, -Infinity, NaN]) {
  for (const raw of sources(values)) {
    const log: string[] = [], slot: Slot = { input: new Source(raw, log), limit };
    assert.throws(RangeError, () => route(slot)); assert.compareArray(log, []);
    const r = slot.input.next(); assert.sameValue(r.done, values.length === 0);
    assert.sameValue(r.value, values[0]); assert.compareArray(log, ["next"]);
  }
}
