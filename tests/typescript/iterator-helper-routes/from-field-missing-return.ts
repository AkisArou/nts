/*---
description: A wrapper synthesizes completion when the plain source has no return without suppressing a later next.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-interfaces]
---*/
// Iterator.from; interface source field; node returns done on return but keeps forwarding next.
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
function route(slot: Slot): IteratorObject<string, unknown, unknown> { return Iterator.from(slot.input); }
interface Slot { input: Iterator<string, unknown, unknown> }
for (const values of [[], ["2"], ["1", "2", "3"]]) for (const raw of sources(values)) {
  const log: string[] = [], slot: Slot = { input: { next() { log.push("next"); return raw.next(); } } };
  const result = route(slot); assert.sameValue(result === slot.input, false); assert.compareArray(log, []);
  if (!result.return) throw new Error("missing wrapper return");
  for (let i = 0; i < 2; i++) { const r = result.return(); assert.sameValue(r.done, true); assert.sameValue(r.value, undefined); }
  assert.compareArray(log, []);
  const step = result.next(); assert.sameValue(step.done, values.length === 0); assert.sameValue(step.value, values[0]);
  assert.compareArray(log, ["next"]);
}
