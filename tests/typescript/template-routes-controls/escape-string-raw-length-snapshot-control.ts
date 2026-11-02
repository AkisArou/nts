/*---
description: Control for a substitution changes a typed raw-length field after String.raw has captured its count.
features: [ts-template-routes, ts-template-route-escapes-raw, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-objects, ts-unknown, ts-interfaces, ts-readonly, ts-accessors, ts-numbers, ts-tuples, ts-conversions, ts-closures, ts-rest-parameters]
---*/
// Plain control: Capture the raw object and numeric length into locals before the explicit interleaving loop; the same conversion mutates the backing field but cannot alter the captured loop bound.
interface RawSource { readonly raw: ArrayLike<string>; }
interface State { limit: number; }
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function rawText(source: { readonly raw: ArrayLike<string> }, ...values: unknown[]): string {
  const raw = source.raw, length = raw.length; let text = "";
  for (let i = 0; i + 1 <= length; i++) { text += String(raw[i]); if (i + 2 <= length && i < values.length) text += String(values[i]); }
  return text;
}
function inspect(next: number, text: string): void {
  const log: unknown[] = [], state: State = { limit: 3 };
  const first = { toString(): string { log.push("first", next); state.limit = next; return text; } };
  const second = { toString(): string { log.push("second"); return "!"; } };
  const raw: ArrayLike<string> = {
    get length(): number { log.push("length", state.limit); return state.limit; }, get 0(): string { log.push("raw0"); return "["; },
    get 1(): string { log.push("raw1"); return ":"; }, get 2(): string { log.push("raw2"); return "]"; }
  };
  const source: RawSource = { get raw(): ArrayLike<string> { log.push("raw"); return raw; } };
  const result = rawText(source, first, second); same(result, "[" + text + ":!]"); same(state.limit, next);
  exact(log, ["raw", "length", 3, "raw0", "first", next, "raw1", "second", "raw2"]);
}
const rows: [number, string][] = [[-0, "zero"], [1, "one"], [5, "five"], [-1, "negative"], [NaN, "nan"], [Infinity, "infinite"]];
for (const [next, text] of rows) inspect(next, text);
