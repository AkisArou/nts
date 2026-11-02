/*---
description: String.raw interleaves typed raw getters and substitution conversions exactly once.
features: [ts-template-routes, ts-template-route-escapes-raw, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-objects, ts-unknown, ts-interfaces, ts-readonly, ts-accessors, ts-this, ts-conversions, ts-closures]
---*/
// Readonly raw interface: node reads raw, length and numeric getters in order, interleaves each typed object conversion, preserves receivers and skips the extra conversion.
interface RawSource { readonly raw: ArrayLike<string>; }
interface Piece { toString(): string; }
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function inspect(input: string): void {
  const log: unknown[] = [];
  const first: Piece = { toString(): string { same(this, first); same(typeof input, "string"); log.push("first", this, input); return input; } };
  const second: Piece = { toString(): string { same(this, second); log.push("second", this, "!"); return "!"; } };
  const extra: Piece = { toString(): string { log.push("extra", this); return "BAD"; } };
  const raw: ArrayLike<string> = {
    get length(): number { log.push("length"); return 3; }, get 0(): string { log.push("raw0"); return "["; },
    get 1(): string { log.push("raw1"); return ","; }, get 2(): string { log.push("raw2"); return "]"; }
  };
  const source: RawSource = { get raw(): ArrayLike<string> { log.push("raw"); return raw; } };
  const result = String.raw(source, first, second, extra); same(result, "[" + input + ",!]");
  exact(log, ["raw", "length", "raw0", "first", first, input, "raw1", "second", second, "!", "raw2"]);
}
for (const input of ["", "x", "\n", "\r\n", "\ud800", "\ud83d\ude00"]) inspect(input);
