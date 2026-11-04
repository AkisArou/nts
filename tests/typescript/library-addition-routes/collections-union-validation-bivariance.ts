/*---
description: "union validates the set-like record through admitted method-parameter bivariance."
features: [ts-library-addition-routes, ts-library-addition-route-collections, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-type-aliases, ts-tuples, ts-unknown, ts-unions, ts-interfaces, ts-class, ts-class-fields, ts-accessors, ts-this, ts-this-parameter, ts-function-types, ts-objects, ts-null-undefined, ts-bigint, ts-symbols, ts-to-primitive, ts-conversions, ts-errors, ts-spread, ts-instanceof, ts-unsound-bivariance]
---*/
// union crosses a bivariant method parameter; node converts size before reading callable members, rejects invalid records by class, and leaves the receiver unchanged.
const log: string[] = [];
type Trial = [unknown, number, "ok" | "type" | "range" | "uri" | "has" | "keys", string[]];
interface Raw { size: unknown; has: unknown; keys: unknown; }
class Other {
  trial: Trial; values: number[] = [2, 3]; constructor(trial: Trial) { log.push("construct"); this.trial = trial; }
  get size(): unknown { log.push("get:size"); return this.trial[0]; }
  get has(): unknown { log.push("get:has"); return this.trial[2] === "has" ? 0 : contains; }
  get keys(): unknown { log.push("get:keys"); return this.trial[2] === "keys" ? null : iterate; }
}
function contains(this: Other, value: number): boolean { log.push("has:" + value); return this.values.includes(value); }
function iterate(this: Other): Iterator<number, undefined> { log.push("keys"); const values = this.values; let index = 0; return {
  next(): IteratorResult<number, undefined> { log.push("next:" + index); return index < values.length ? { done: false, value: values[index++] } : { done: true, value: undefined }; },
  return(): IteratorResult<number, undefined> { log.push("return"); return { done: true, value: undefined }; } }; }
const trials: Trial[] = [
  ["2.9", 2, "ok", []], [2.9, 2, "ok", []], [-0, 0, "ok", []], [-0.5, 0, "ok", []], [Infinity, Infinity, "ok", []],
  [false, 0, "ok", []], [true, 1, "ok", []], [null, 0, "ok", []], ["", 0, "ok", []],
  [NaN, 0, "type", []], ["bad", 0, "type", []], [undefined, 0, "type", []], [0n, 0, "type", []], [Symbol("size"), 0, "type", []],
  [-1, 0, "range", []], ["-1", 0, "range", []], [-Infinity, 0, "range", []], [2, 2, "has", []], [2, 2, "keys", []],
  [{ valueOf(): string { log.push("valueOf"); return "2.9"; } }, 2, "ok", ["valueOf"]],
  [{ valueOf(): object { log.push("valueOf"); return {}; }, toString(): string { log.push("toString"); return "2.9"; } }, 2, "ok", ["valueOf", "toString"]],
  [{ valueOf(): number { log.push("valueOf"); return NaN; } }, 0, "type", ["valueOf"]],
  [{ valueOf(): number { log.push("valueOf"); throw new URIError("size"); } }, 0, "uri", ["valueOf"]]];
interface Narrow { run(other: ReadonlySetLike<number>): Set<number>; } interface Wide { run(other: Raw): Set<number>; }
for (const trial of trials) {
  const left = new Set([1, 2]), other = new Other(trial);
  const narrow: Narrow = { run(other: ReadonlySetLike<number>): Set<number> { log.push("run");
    return left.union(other);
  } };
  const wide: Wide = narrow, result: { value: Set<number> | undefined } = { value: undefined };
  function invoke(): void { log.push("invoke"); result.value = wide.run(other); }
  log.length = 0;
  if (trial[2] === "ok") invoke(); else assert.throws(trial[2] === "range" ? RangeError : trial[2] === "uri" ? URIError : TypeError, invoke);
  const expected = ["invoke", "run", "get:size", ...trial[3]];
  if (trial[2] === "ok" || trial[2] === "has" || trial[2] === "keys") { expected.push("get:has"); if (trial[2] !== "has") expected.push("get:keys"); if (trial[2] === "ok") expected.push(...(["keys", "next:0", "next:1", "next:2"])); }
  assert.compareArray(log, expected); assert.compareArray([...left], [1, 2]); assert.sameValue(left.size, 2);
  if (trial[2] === "ok") { const view = result.value; if (view === undefined) throw new Test262Error("missing result"); assert.compareArray([...view], [1, 2, 3]); assert.sameValue(view.size, 3); assert.sameValue(view === left, false); assert.sameValue(view instanceof Set, true); }
  else assert.sameValue(result.value, undefined);
}
