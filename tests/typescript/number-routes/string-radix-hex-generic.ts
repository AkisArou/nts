/*---
description: Hexadecimal radix formatting observes an instantiated generic numeric field.
features: [ts-number-route-strings, ts-numbers, ts-conversions, ts-class, ts-class-fields, ts-generics]
---*/
// Route: an instantiated generic numeric field -> Hexadecimal radix formatting; node preserves the raw number and the exact result, including signed-zero observations.
interface FormatSample { input: number; raw: number; rawText: string; text: string; inverse?: number; }
const samples: FormatSample[] = [
  { input: 0, raw: 0, rawText: "0", text: "0", inverse: Infinity },
  { input: -0, raw: -0, rawText: "0", text: "0", inverse: -Infinity },
  { input: 255, raw: 255, rawText: "255", text: "ff" },
  { input: 10.5, raw: 10.5, rawText: "10.5", text: "a.8" },
  { input: -0.125, raw: -0.125, rawText: "-0.125", text: "-0.2" },
  { input: 0.1, raw: 0.1, rawText: "0.1", text: "0.1999999999999a" },
  { input: 0.1 + 0.2, raw: 0.30000000000000004, rawText: "0.30000000000000004", text: "0.4cccccccccccd" },
  { input: 1.5e-7, raw: 1.5e-7, rawText: "1.5e-7", text: "0.000002843ebe81b06ec" },
  { input: 1e21, raw: 1e+21, rawText: "1e+21", text: "3635c9adc5dea00000" },
  { input: 9007199254740991, raw: 9007199254740991, rawText: "9007199254740991", text: "1fffffffffffff" },
  { input: Number.NaN, raw: Number.NaN, rawText: "NaN", text: "NaN" },
  { input: Infinity, raw: Infinity, rawText: "Infinity", text: "Infinity" },
  { input: -Infinity, raw: -Infinity, rawText: "-Infinity", text: "-Infinity" }
];
class NumericCarrier<T> { value: T; constructor(value: T) { this.value = value; } }
function checkNumber(actual: number, expected: number, text: string, inverse?: number): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, inverse), true);
}
for (const sample of samples) {
  const slot = new NumericCarrier<number>(0); slot.value = sample.input;
  const observed: number = slot.value;
  checkNumber(observed, sample.raw, sample.rawText, sample.inverse);
  const result: string = observed.toString(16);
  assert.sameValue(Object.is(result, sample.text), true); assert.sameValue(typeof result, "string");
  assert.sameValue(String(result), sample.text);
}
