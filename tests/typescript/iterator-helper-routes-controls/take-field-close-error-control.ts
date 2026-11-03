/*---
description: A take helper stored in a field propagates the closing error once and then stays completed.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-interfaces, ts-errors]
---*/
// take; interface helper field; node rethrows the source close error by identity, without a second close.
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
class Manual extends Iterator<string, undefined, unknown> {
  input: View; left: number; closed: boolean = false;
  constructor(input: View, limit: number) { super(); this.input = input; this.left = Math.trunc(limit); }
  next(): Step {
    if (this.closed) return { done: true, value: undefined };
    if (this.left === 0) { this.closed = true; this.input.return?.(); return { done: true, value: undefined }; }
    this.left--; const r = this.input.next(); if (r.done) this.closed = true; return r;
  }
  return(): Step { if (!this.closed) { this.closed = true; this.input.return?.(); } return { done: true, value: undefined }; }
}
const failure = new Error("close failure");
class Failing extends Source { return(): Step { this.log.push("return"); throw failure; } }
interface Slot { helper: View }
function route(input: View, n: number): View { return new Manual(input, n); }
for (const values of [["2"], ["1", "2", "3"]]) for (const limit of [0, 1]) for (const raw of sources(values)) {
  const log: string[] = [], slot: Slot = { helper: route(new Failing(raw, log), limit) };
  assert.compareArray(log, []);
  for (let i = 0; i < limit; i++) { const r = slot.helper.next(); assert.sameValue(r.done, false); assert.sameValue(r.value, values[i]); }
  assert.compareArray(log, Array(limit).fill("next"));
  let caught: unknown; try { slot.helper.next(); } catch (error) { caught = error; }
  assert.sameValue(caught, failure); const expected: string[] = Array(limit).fill("next"); expected.push("return");
  assert.compareArray(log, expected);
  const end = slot.helper.next(); assert.sameValue(end.done, true); assert.sameValue(end.value, undefined);
  if (!slot.helper.return) throw new Error("missing helper return");
  const closed = slot.helper.return(); assert.sameValue(closed.done, true); assert.sameValue(closed.value, undefined);
  assert.compareArray(log, expected);
}
