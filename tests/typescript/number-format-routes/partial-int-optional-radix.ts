/*---
description: "An optional radix parameter distinguishes omitted, explicit undefined and zero calls while preserving hexadecimal inference."
features: [ts-number-format-routes, ts-number-format-route-partial-parsing, ts-numbers, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-typeof-operator, ts-unknown, ts-strings, ts-type-aliases, ts-unions, ts-optional-parameters, ts-literal-types, ts-null-undefined]
---*/
// Typed modes select actual one-argument or two-argument parseInt calls; the log retains the raw optional radix, source and result. Node infers hexadecimal only from a signed or unsigned 0x prefix.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const inputs: string[] = [
  "0x10", "-0Xf", "+0x0", "-0x0", "0x",
  "-0xg", "010", "08", "0b11", "0o11",
  "1e3", "-0", "", "Infinity",
];
const expected: number[] = [
  16, -15, 0, -0, NaN, NaN, 10,
  8, 0, 0, 1, -0, NaN, NaN,
];
const log: unknown[] = [], wanted: unknown[] = [];
type Mode = "omitted" | "undefined" | "zero";
const modes: Mode[] = ["omitted", "undefined", "zero"];
function consume(text: string, index: number, mode: Mode, radix?: number): number {
  same(text, inputs[index]); same(radix, mode === "zero" ? 0 : undefined);
  let value: number;
  if (mode === "omitted") value = parseInt(text);
  else value = parseInt(text, radix);
  same(value, expected[index]); log.push(mode, text, radix, value); return value;
}
const retained: number[] = [], expectedRetained: number[] = [];
for (let index = 0; index < inputs.length; index++) for (const mode of modes) {
  const text = inputs[index];
  const value = mode === "omitted" ? consume(text, index, mode) : consume(text, index, mode, mode === "zero" ? 0 : undefined);
  retained.push(value); expectedRetained.push(expected[index]); same(value, expected[index]);
  wanted.push(mode, text, mode === "zero" ? 0 : undefined, expected[index]);
}
same(retained.length, inputs.length * modes.length);
for (let index = 0; index < retained.length; index++) same(retained[index], expectedRetained[index]);
assert.compareArray(log, wanted);
