/*---
description: A generic symbol parameter gives identical exact strings from toString and explicit String conversion.
features: [ts-symbol-route-values, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-null-undefined, ts-generics, ts-tuples, ts-conversions]
---*/
// A symbol crosses a generic parameter; node returns the exact descriptive string through both explicit string conversions without changing identity.
type Token = symbol;
function fresh(description: string | undefined): Token { return Symbol(description); }
function convert<T extends Token>(value: T): [string, string] { return [value.toString(), String(value)]; }
const rows: { description: string | undefined; expected: string }[] = [
  { description: undefined, expected: "Symbol()" }, { description: "", expected: "Symbol()" }, { description: "same", expected: "Symbol(same)" },
  { description: "A\u0000B", expected: "Symbol(A\u0000B)" }, { description: "\ud83d\ude00", expected: "Symbol(\ud83d\ude00)" }, { description: "\ud800", expected: "Symbol(\ud800)" }
];
for (const row of rows) {
  const first: Token = fresh(row.description), second: Token = fresh(row.description), before: Token[] = [first, second];
  assert.sameValue(first === second, false); assert.compareArray(convert(first), [row.expected, row.expected]); assert.compareArray(convert(second), [row.expected, row.expected]);
  assert.compareArray(before, [first, second]);
}
