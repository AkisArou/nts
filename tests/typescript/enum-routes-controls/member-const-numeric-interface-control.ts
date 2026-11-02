/*---
description: "Control for member-const-numeric-interface; Inlined numeric const-enum members survive interface field writes and previous-value returns with exact finite values."
features: [ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-literal-members, ts-interfaces, ts-literal-types, ts-type-aliases, ts-unions]
---*/
// Every InlineNumber member, including its alias, crosses the same interface update; node logs the old and new values and the caller observes both representations exactly. The control uses frozen forward values and literal types, plus explicit reverse entries where observed.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const InlineNumber = Object.freeze({ Zero: 0, Fraction: 1.5, Negative: -7, Wide: 4294967297, Alias: 1.5 }); type InlineNumber = 0 | 1.5 | -7 | 4294967297;
interface InlineNumberCell { value: InlineNumber; }
function replace(cell: InlineNumberCell, next: InlineNumber, log: unknown[]): InlineNumber { const previous = cell.value; cell.value = next; log.push("replace", previous, typeof previous, cell.value, typeof cell.value); return previous; }
const inputs: InlineNumber[] = [InlineNumber.Zero, InlineNumber.Fraction, InlineNumber.Negative, InlineNumber.Wide, InlineNumber.Alias], raw = [0, 1.5, -7, 4294967297, 1.5];
const next: InlineNumber[] = [InlineNumber.Fraction, InlineNumber.Negative, InlineNumber.Wide, InlineNumber.Zero, InlineNumber.Wide], expected = [1.5, -7, 4294967297, 0, 4294967297];
for (let at = 0; at < inputs.length; at++) {
  const cell: InlineNumberCell = { value: inputs[at] }, log: unknown[] = [];
  same(cell.value, raw[at]); const previous: InlineNumber = replace(cell, next[at], log); same(previous, raw[at]); same(cell.value, expected[at]);
  log.push("return", previous, "field", cell.value); exact(log, ["replace", raw[at], "number", expected[at], "number", "return", raw[at], "field", expected[at]]);
}
