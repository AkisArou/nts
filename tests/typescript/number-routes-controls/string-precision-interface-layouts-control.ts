/*---
description: Control for string-precision-interface-layouts; the same conversion and arithmetic use plain number locals.
features: [ts-number-route-strings, ts-numbers, ts-conversions, ts-class, ts-class-fields, ts-interfaces]
---*/
// Control: ../number-routes/string-precision-interface-layouts.ts; replace only the numeric carrier with plain number locals.
interface FormatSample { input: number; raw: number; rawText: string; text: string; inverse?: number; }
const samples: FormatSample[] = [
  { input: 0, raw: 0, rawText: "0", text: "0.00", inverse: Infinity },
  { input: -0, raw: -0, rawText: "0", text: "0.00", inverse: -Infinity },
  { input: 7, raw: 7, rawText: "7", text: "7.00" },
  { input: 1.5, raw: 1.5, rawText: "1.5", text: "1.50" },
  { input: 999, raw: 999, rawText: "999", text: "999" },
  { input: 999.5, raw: 999.5, rawText: "999.5", text: "1.00e+3" },
  { input: 1234.5678, raw: 1234.5678, rawText: "1234.5678", text: "1.23e+3" },
  { input: 0.1 + 0.2, raw: 0.30000000000000004, rawText: "0.30000000000000004", text: "0.300" },
  { input: 1e21, raw: 1e+21, rawText: "1e+21", text: "1.00e+21" },
  { input: 1e-6, raw: 0.000001, rawText: "0.000001", text: "0.00000100" },
  { input: 1.5e-7, raw: 1.5e-7, rawText: "1.5e-7", text: "1.50e-7" },
  { input: Number.NaN, raw: Number.NaN, rawText: "NaN", text: "NaN" },
  { input: Infinity, raw: Infinity, rawText: "Infinity", text: "Infinity" },
  { input: -Infinity, raw: -Infinity, rawText: "-Infinity", text: "-Infinity" }
];
interface NumericView { value: number; }
class LeadingCarrier implements NumericView { value: number = 0; label: string = "leading"; }
class TrailingCarrier implements NumericView { label: string = "trailing"; value: number = 0; }
function checkNumber(actual: number, expected: number, text: string, inverse?: number): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, inverse), true);
}
for (const sample of samples) for (const alternate of [false, true]) {
  let slot: number = 0;
  slot = sample.input; const observed: number = slot;
  checkNumber(observed, sample.raw, sample.rawText, sample.inverse);
  const result: string = observed.toPrecision(3);
  assert.sameValue(Object.is(result, sample.text), true); assert.sameValue(typeof result, "string");
  assert.sameValue(String(result), sample.text);
}
