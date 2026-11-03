/*---
description: Returning a stored helper before or after its first pull closes the source once and prevents further callbacks.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-interfaces]
---*/
// map helper; interface field; node closes unstarted or suspended helpers once, but not completed ones.
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
for (const values of [[], ["2"], ["1", "2", "3"]]) for (const started of [false, true]) for (const raw of sources(values)) {
  const log: string[] = [], input: View = new Source(raw, log);
  const callback = (v: string, i: number): string => { log.push("map:" + v + ":" + i); return v; };
  const slot: Slot = { current: input.map(callback) }; const expected: string[] = []; assert.compareArray(log, []);
  if (started) {
    const r = slot.current.next(); assert.sameValue(r.done, values.length === 0); assert.sameValue(r.value, values[0]);
    expected.push("next"); if (values.length) expected.push("map:" + values[0] + ":0"); assert.compareArray(log, expected);
  }
  if (!slot.current.return) throw new Error("missing helper return");
  const closed = slot.current.return(); assert.sameValue(closed.done, true); assert.sameValue(closed.value, undefined);
  if (!started || values.length) expected.push("return"); assert.compareArray(log, expected);
  const end = slot.current.next(); assert.sameValue(end.done, true); assert.sameValue(end.value, undefined);
  const twice = slot.current.return(); assert.sameValue(twice.done, true); assert.sameValue(twice.value, undefined);
  assert.compareArray(log, expected);
}
