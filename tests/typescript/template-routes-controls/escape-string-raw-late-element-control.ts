/*---
description: Control for a typed substitution mutates the next raw element before String.raw reads it.
features: [ts-template-routes, ts-template-route-escapes-raw, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-objects, ts-unknown, ts-interfaces, ts-readonly, ts-accessors, ts-conversions, ts-closures, ts-rest-parameters]
---*/
// Plain control: Read and append each raw element immediately before its corresponding substitution; both paths use the same typed backing cell and explicit String conversions.
interface RawSource { readonly raw: ArrayLike<string>; }
interface Cell { text: string; }
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function rawText(source: { readonly raw: ArrayLike<string> }, ...values: unknown[]): string {
  const raw = source.raw, length = raw.length; let text = "";
  for (let i = 0; i + 1 <= length; i++) { text += String(raw[i]); if (i + 2 <= length && i < values.length) text += String(values[i]); }
  return text;
}
function inspect(input: string): void {
  const log: unknown[] = [], cell: Cell = { text: "old" };
  const first = { toString(): string { log.push("first", cell.text, input); cell.text = input; return "#"; } };
  const second = { toString(): string { log.push("second", cell.text); return "!"; } };
  const raw: ArrayLike<string> = {
    get length(): number { log.push("length"); return 3; }, get 0(): string { log.push("raw0"); return "<"; },
    get 1(): string { log.push("raw1", cell.text); return cell.text; }, get 2(): string { log.push("raw2"); return ">"; }
  };
  const source: RawSource = { get raw(): ArrayLike<string> { log.push("raw"); return raw; } };
  const result = rawText(source, first, second); same(result, "<#" + input + "!>"); same(cell.text, input);
  exact(log, ["raw", "length", "raw0", "first", "old", input, "raw1", input, "second", input, "raw2"]);
}
for (const input of ["", "x", "\n", "\\n", "\ud800", "\ud83d\ude00"]) inspect(input);
