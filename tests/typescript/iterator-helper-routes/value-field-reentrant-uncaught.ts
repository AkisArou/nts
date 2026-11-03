/*---
description: An uncaught reentrant next error closes the source once and leaves the stored helper completed.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-interfaces, ts-errors]
---*/
// map helper; interface field; node throws TypeError, closes once, and never invokes the callback again.
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
interface Slot { current: View }
for (const values of [[], ["2"], ["1", "2", "3"]]) for (const raw of sources(values)) {
  const log: string[] = [], input: View = new Source(raw, log), slot: Slot = { current: input };
  const callback = (v: string, i: number): string => { log.push("map:" + v + ":" + i); slot.current.next(); return v; };
  slot.current = input.map(callback); assert.compareArray(log, []);
  if (values.length) assert.throws(TypeError, () => slot.current.next());
  else { const r = slot.current.next(); assert.sameValue(r.done, true); assert.sameValue(r.value, undefined); }
  const expected = values.length ? ["next", "map:" + values[0] + ":0", "return"] : ["next"]; assert.compareArray(log, expected);
  const end = slot.current.next(); assert.sameValue(end.done, true); assert.sameValue(end.value, undefined);
  if (!slot.current.return) throw new Error("missing helper return");
  const closed = slot.current.return(); assert.sameValue(closed.done, true); assert.sameValue(closed.value, undefined); assert.compareArray(log, expected);
}
