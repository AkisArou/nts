/*---
description: Every through an interface field closes once on a decision and does not pull the tail.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-interfaces]
---*/
// every; interface source field; node distinguishes empty, unmatched and short-circuit inputs.
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
function route(slot: Slot, callback: (v: string, i: number) => boolean): boolean {
  let i = 0; while (true) {
    const r = slot.input.next(); if (r.done) return true; const accepted = callback(r.value, i++);
    if (!accepted) { slot.input.return?.(); return false; }
  }
}
interface Slot { input: View }
for (const values of [[], ["2"], ["1"], ["1", "2", "3"], ["1", "3"]]) for (const raw of sources(values)) {
  const log: string[] = [], slot: Slot = { input: new Source(raw, log) };
  const callback = (v: string, i: number): boolean => { log.push("call:" + v + ":" + i); return v !== "2"; };
  assert.compareArray(log, []); const got = route(slot, callback), hit = values.indexOf("2");
  assert.sameValue(got, hit < 0); const expected: string[] = [];
  const count = hit < 0 ? values.length : hit + 1;
  for (let i = 0; i < count; i++) expected.push("next", "call:" + values[i] + ":" + i);
  expected.push(hit < 0 ? "next" : "return"); assert.compareArray(log, expected);
}
