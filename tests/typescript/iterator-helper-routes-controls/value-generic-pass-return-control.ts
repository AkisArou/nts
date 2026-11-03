/*---
description: A helper passed and returned by one generic function retains its identity and suspended state.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-generics]
---*/
// map helper; generic parameter and return; node returns the same helper and resumes its own counter.
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
  input: View; callback: (v: string, i: number) => string; index: number = 0; closed: boolean = false; running: boolean = false;
  constructor(input: View, callback: (v: string, i: number) => string) { super(); this.input = input; this.callback = callback; }
  next(): Step {
    if (this.running) throw new TypeError(); if (this.closed) return { done: true, value: undefined };
    this.running = true;
    try { const r = this.input.next(); if (r.done) { this.closed = true; return r; } return { done: false, value: this.callback(r.value, this.index++) }; }
    catch (error) { this.closed = true; try { this.input.return?.(); } catch {} throw error; } finally { this.running = false; }
  }
  return(): Step { if (this.running) throw new TypeError(); if (!this.closed) { this.closed = true; this.input.return?.(); } return { done: true, value: undefined }; }
}
function relay<T>(helper: IteratorObject<T, undefined, unknown>): IteratorObject<T, undefined, unknown> { return helper; }
interface Slot { current: View }
for (const values of [[], ["2"], ["1", "2", "3"]]) for (const raw of sources(values)) {
  const log: string[] = [], input: View = new Source(raw, log);
  const callback = (v: string, i: number): string => { log.push("map:" + v + ":" + i); return v + "!"; };
  const before: View = new Manual(input, callback); const slot: Slot = { current: relay(before) };
  assert.sameValue(slot.current, before);
  assert.compareArray(log, []); assert.sameValue(slot.current[Symbol.iterator](), slot.current); const expected: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const r = slot.current.next(); assert.sameValue(r.done, false); assert.sameValue(r.value, values[i] + "!");
    expected.push("next", "map:" + values[i] + ":" + i); assert.compareArray(log, expected);
  }
  const end = slot.current.next(); assert.sameValue(end.done, true); assert.sameValue(end.value, undefined); expected.push("next");
  assert.compareArray(log, expected); const again = slot.current.next(); assert.sameValue(again.done, true); assert.sameValue(again.value, undefined);
  assert.compareArray(log, expected);
}
