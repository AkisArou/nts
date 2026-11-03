/*---
description: A plain iterator in a tuple is wrapped and forwards receiver and result identity without caller arguments.
features: [ts-iteration, ts-class, ts-class-fields, ts-generators, ts-arrays, ts-map-set, ts-tuples]
---*/
// Iterator.from; iterator tuple; node wraps plain objects and forwards next and return with no arguments.
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
class Manual extends Iterator<string, unknown, unknown> {
  input: Iterator<string, unknown, unknown>;
  constructor(input: Iterator<string, unknown, unknown>) { super(); this.input = input; }
  next(): IteratorResult<string, unknown> { return this.input.next(); }
  return(): IteratorResult<string, unknown> { return this.input.return ? this.input.return() : { done: true, value: undefined }; }
}
function route(pair: [Iterator<string, unknown, unknown>]): IteratorObject<string, unknown, unknown> { return new Manual(pair[0]); }
for (const values of [[], ["2"], ["1", "2", "3"]]) for (const raw of sources(values)) {
  const log: string[] = []; let last: IteratorResult<string, unknown> = { done: true, value: undefined };
  const input: Iterator<string, unknown, unknown> = {
    next(...args: unknown[]): IteratorResult<string, unknown> { assert.sameValue(this, input); log.push("next:" + args.length); last = raw.next(); return last; },
    return(...args: unknown[]): IteratorResult<string, unknown> { assert.sameValue(this, input); log.push("return:" + args.length); raw.return?.(); last = { done: true, value: "closed" }; return last; }
  };
  const tuple: [Iterator<string, unknown, unknown>] = [input], result = route(tuple);
  assert.sameValue(result === input, false); assert.sameValue(result[Symbol.iterator](), result); assert.compareArray(log, []);
  const r = result.next("ignored"); assert.sameValue(r, last); assert.sameValue(r.done, values.length === 0); assert.sameValue(r.value, values[0]);
  assert.compareArray(log, ["next:0"]); if (!result.return) throw new Error("missing wrapper return");
  const closed = result.return("ignored"); assert.sameValue(closed, last); assert.sameValue(closed.done, true); assert.sameValue(closed.value, "closed");
  assert.compareArray(log, ["next:0", "return:0"]);
}
