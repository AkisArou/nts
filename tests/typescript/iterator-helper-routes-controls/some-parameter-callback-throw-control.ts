/*---
description: some closes its typed source once when a callback throws and preserves the exception identity.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-functions, ts-errors]
---*/
// some; View parameter; node preserves the callback error and does not visit later values.
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
function route(input: View, callback: (v: string, i: number) => boolean): boolean {
  let i = 0; while (true) {
    const r = input.next(); if (r.done) return false;
    try { callback(r.value, i++); } catch (error) { try { input.return?.(); } catch {} throw error; }
  }
}
const failure = new Error("callback failure");
for (const values of [[], ["2"], ["1", "2", "3"]]) for (const stop of [0, 1]) for (const raw of sources(values)) {
  const log: string[] = [], input: View = new Source(raw, log);
  const callback = (v: string, i: number): boolean => { log.push("call:" + v + ":" + i); if (i === stop) throw failure; return false; };
  assert.compareArray(log, []); let caught: unknown, result: unknown;
  try { result = route(input, callback); } catch (error) { caught = error; }
  const throws = stop < values.length; assert.sameValue(caught, throws ? failure : undefined);
  if (!throws) assert.sameValue(result, false);
  const expected: string[] = [], count = throws ? stop + 1 : values.length;
  for (let i = 0; i < count; i++) expected.push("next", "call:" + values[i] + ":" + i);
  expected.push(throws ? "return" : "next"); assert.compareArray(log, expected);
}
