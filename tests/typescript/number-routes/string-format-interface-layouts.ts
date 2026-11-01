/*---
description: String conversion observes an interface number property across two class layouts.
features: [ts-number-route-strings, ts-numbers, ts-conversions, ts-class, ts-class-fields, ts-interfaces]
---*/
// Route: an interface number property across two class layouts -> String conversion; node preserves the raw number and the exact result, including signed-zero observations.
interface FormatSample { input: number; raw: number; rawText: string; text: string; inverse?: number; }
const samples: FormatSample[] = [
  { input: 0, raw: 0, rawText: "0", text: "0", inverse: Infinity },
  { input: -0, raw: -0, rawText: "0", text: "0", inverse: -Infinity },
  { input: 7, raw: 7, rawText: "7", text: "7" },
  { input: 1.5, raw: 1.5, rawText: "1.5", text: "1.5" },
  { input: -1.5, raw: -1.5, rawText: "-1.5", text: "-1.5" },
  { input: 0.1 + 0.2, raw: 0.30000000000000004, rawText: "0.30000000000000004", text: "0.30000000000000004" },
  { input: 1e21, raw: 1e+21, rawText: "1e+21", text: "1e+21" },
  { input: 1.5e-7, raw: 1.5e-7, rawText: "1.5e-7", text: "1.5e-7" },
  { input: 1e-6, raw: 0.000001, rawText: "0.000001", text: "0.000001" },
  { input: 2147483648, raw: 2147483648, rawText: "2147483648", text: "2147483648" },
  { input: 9007199254740991, raw: 9007199254740991, rawText: "9007199254740991", text: "9007199254740991" },
  { input: 9007199254740993, raw: 9007199254740992, rawText: "9007199254740992", text: "9007199254740992" },
  { input: Number.MIN_VALUE, raw: 5e-324, rawText: "5e-324", text: "5e-324" },
  { input: Number.MAX_VALUE, raw: 1.7976931348623157e+308, rawText: "1.7976931348623157e+308", text: "1.7976931348623157e+308" },
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
  const slot: NumericView = alternate ? new TrailingCarrier() : new LeadingCarrier();
  slot.value = sample.input; const observed: number = slot.value;
  checkNumber(observed, sample.raw, sample.rawText, sample.inverse);
  const result: string = String(observed);
  assert.sameValue(Object.is(result, sample.text), true); assert.sameValue(typeof result, "string");
  assert.sameValue(String(result), sample.text);
}
