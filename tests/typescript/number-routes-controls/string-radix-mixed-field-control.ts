/*---
description: Control for string-radix-mixed-field; the same conversion and arithmetic use plain number locals.
features: [ts-number-route-strings, ts-numbers, ts-conversions, ts-class, ts-class-fields]
---*/
// Control: ../number-routes/string-radix-mixed-field.ts; replace only the numeric carrier with plain number locals.
interface FormatSample { input: number; raw: number; rawText: string; text: string; inverse?: number; radix: number; }
const samples: FormatSample[] = [
  { input: 0, raw: 0, rawText: "0", text: "0", inverse: Infinity, radix: 3 },
  { input: -0, raw: -0, rawText: "0", text: "0", inverse: -Infinity, radix: 36 },
  { input: 35, raw: 35, rawText: "35", text: "z", radix: 36 },
  { input: 0.5, raw: 0.5, rawText: "0.5", text: "0.1111111111111111111111111111111112", radix: 3 },
  { input: 0.1, raw: 0.1, rawText: "0.1", text: "0.0022002200220022002200220022002201", radix: 3 },
  { input: 0.1, raw: 0.1, rawText: "0.1", text: "0.0631463146314631464", radix: 8 },
  { input: 10.5, raw: 10.5, rawText: "10.5", text: "12.4", radix: 8 },
  { input: 0.1 + 0.2, raw: 0.30000000000000004, rawText: "0.30000000000000004", text: "0.30000000000000004", radix: 10 },
  { input: 1.5e-7, raw: 1.5e-7, rawText: "1.5e-7", text: "0.000092imhi0c8qb", radix: 36 },
  { input: 1e21, raw: 1e+21, rawText: "1e+21", text: "5v1j4f4ds7c000", radix: 36 },
  { input: Number.NaN, raw: Number.NaN, rawText: "NaN", text: "NaN", radix: 3 },
  { input: Infinity, raw: Infinity, rawText: "Infinity", text: "Infinity", radix: 8 },
  { input: -Infinity, raw: -Infinity, rawText: "-Infinity", text: "-Infinity", radix: 36 }
];
class NumericCarrier { value: number = 0; }
function checkNumber(actual: number, expected: number, text: string, inverse?: number): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, inverse), true);
}
for (const sample of samples) {
  let slot: number = 0; slot = sample.input;
  const observed: number = slot;
  checkNumber(observed, sample.raw, sample.rawText, sample.inverse);
  const result: string = observed.toString(sample.radix);
  assert.sameValue(Object.is(result, sample.text), true); assert.sameValue(typeof result, "string");
  assert.sameValue(String(result), sample.text);
}
