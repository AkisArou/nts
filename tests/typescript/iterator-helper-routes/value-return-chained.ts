/*---
description: A returned map-filter-take chain preserves lazy callback order and closes the underlying source once.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-functions]
---*/
// map/filter/take helpers; typed return; node pulls through rejects, yields 2!, then closes on resumption.
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
function route(input: View, log: string[]): View {
  return input.map((v, i) => { log.push("map:" + v + ":" + i); return v + "!"; })
    .filter((v, i) => { log.push("filter:" + v + ":" + i); return v === "2!"; }).take(1);
}
for (const values of [[], ["2"], ["1"], ["1", "2", "3"]]) for (const raw of sources(values)) {
  const log: string[] = [], helper: View = route(new Source(raw, log), log); assert.compareArray(log, []);
  const hit = values.indexOf("2"), expected: string[] = [], count = hit < 0 ? values.length : hit + 1;
  for (let i = 0; i < count; i++) expected.push("next", "map:" + values[i] + ":" + i, "filter:" + values[i] + "!:" + i);
  if (hit < 0) expected.push("next"); const first = helper.next();
  assert.sameValue(first.done, hit < 0); assert.sameValue(first.value, hit < 0 ? undefined : "2!"); assert.compareArray(log, expected);
  const end = helper.next(); assert.sameValue(end.done, true); assert.sameValue(end.value, undefined);
  if (hit >= 0) expected.push("return"); assert.compareArray(log, expected);
  const again = helper.next(); assert.sameValue(again.done, true); assert.sameValue(again.value, undefined); assert.compareArray(log, expected);
}
