/*---
description: Typed raw getters and substitution conversions propagate the exact abrupt completion.
features: [ts-template-routes, ts-template-route-escapes-raw, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-objects, ts-unknown, ts-interfaces, ts-readonly, ts-accessors, ts-unions, ts-literal-types, ts-tuples, ts-errors, ts-this, ts-conversions, ts-spread, ts-closures]
---*/
// A literal-union stage selects a throwing raw/length/index getter or substitution conversion; node preserves the exact RangeError, skips every later operation and leaves the result unwritten.
type Stage = "raw" | "length" | "first" | "convert" | "last" | "none";
interface RawSource { readonly raw: ArrayLike<string>; }
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function inspect(stage: Stage, events: string[], input: string): void {
  const log: unknown[] = [], failure = new RangeError(stage); let result = "untouched";
  function step(name: string): void { log.push(name); if (stage === name) throw failure; }
  const raw: ArrayLike<string> = {
    get length(): number { step("length"); return 2; }, get 0(): string { step("first"); return "<"; }, get 1(): string { step("last"); return ">"; }
  };
  const source: RawSource = { get raw(): ArrayLike<string> { step("raw"); return raw; } };
  const token = { toString(): string { same(this, token); step("convert"); return input; } };
  function invoke(): void { try { result = String.raw(source, token); } catch (error) { same(error, failure); log.push("caught", error); throw error; } }
  if (stage === "none") { invoke(); same(result, "<" + input + ">"); exact(log, events); }
  else { assert.throws(RangeError, invoke); same(result, "untouched"); exact(log, [...events, "caught", failure]); }
}
const rows: [Stage, string[]][] = [
  ["raw", ["raw"]], ["length", ["raw", "length"]], ["first", ["raw", "length", "first"]],
  ["convert", ["raw", "length", "first", "convert"]], ["last", ["raw", "length", "first", "convert", "last"]],
  ["none", ["raw", "length", "first", "convert", "last"]]
];
for (const [stage, events] of rows) for (const input of ["", "x", "\ud800"]) inspect(stage, events, input);
