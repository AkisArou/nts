/*---
description: Returning a flatMap helper in a tuple closes the active inner iterator before its outer iterator.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-tuples]
---*/
// flatMap helper; typed tuple; node closes inner then outer exactly once and discards the unpulled inner tail.
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
for (const values of [[], ["2"], ["1", "2", "3"]]) for (const raw of sources(values)) {
  const log: string[] = [], outer: View = new Source(raw, log);
  const mapper = (v: string, i: number): View => {
    log.push("map:" + v + ":" + i); const inner = new Source([v, v + "!"].values(), log);
    const next = inner.next, close = inner.return;
    inner.next = () => { log.push("inner"); return next.call(inner); };
    inner.return = () => { log.push("inner-close"); return close.call(inner); }; return inner;
  };
  const tuple: [View] = [outer.flatMap(mapper)]; assert.compareArray(log, []); const first = tuple[0].next();
  assert.sameValue(first.done, values.length === 0); assert.sameValue(first.value, values[0]);
  const expected = values.length ? ["next", "map:" + values[0] + ":0", "inner", "next"] : ["next"];
  assert.compareArray(log, expected); if (!tuple[0].return) throw new Error("missing helper return");
  const end = tuple[0].return(); assert.sameValue(end.done, true); assert.sameValue(end.value, undefined);
  if (values.length) expected.push("inner-close", "return", "return"); assert.compareArray(log, expected);
  const again = tuple[0].next(); assert.sameValue(again.done, true); assert.sameValue(again.value, undefined);
  const twice = tuple[0].return(); assert.sameValue(twice.done, true); assert.sameValue(twice.value, undefined); assert.compareArray(log, expected);
}
