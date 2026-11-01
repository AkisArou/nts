/*---
description: Binary radix formatting observes a readonly number array element.
features: [ts-number-route-strings, ts-numbers, ts-conversions, ts-arrays, ts-readonly]
---*/
// Route: a readonly number array element -> Binary radix formatting; node preserves the raw number and the exact result, including signed-zero observations.
interface FormatSample { input: number; raw: number; rawText: string; text: string; inverse?: number; }
const samples: FormatSample[] = [
  { input: 0, raw: 0, rawText: "0", text: "0", inverse: Infinity },
  { input: -0, raw: -0, rawText: "0", text: "0", inverse: -Infinity },
  { input: 7, raw: 7, rawText: "7", text: "111" },
  { input: 255, raw: 255, rawText: "255", text: "11111111" },
  { input: 0.5, raw: 0.5, rawText: "0.5", text: "0.1" },
  { input: -0.125, raw: -0.125, rawText: "-0.125", text: "-0.001" },
  { input: 0.1, raw: 0.1, rawText: "0.1", text: "0.0001100110011001100110011001100110011001100110011001101" },
  { input: 0.1 + 0.2, raw: 0.30000000000000004, rawText: "0.30000000000000004", text: "0.0100110011001100110011001100110011001100110011001101" },
  { input: 1.5e-7, raw: 1.5e-7, rawText: "1.5e-7", text: "0.00000000000000000000001010000100001111101011111010000001101100000110111011" },
  { input: 1e21, raw: 1e+21, rawText: "1e+21", text: "1101100011010111001001101011011100010111011110101000000000000000000000" },
  { input: 9007199254740991, raw: 9007199254740991, rawText: "9007199254740991", text: "11111111111111111111111111111111111111111111111111111" },
  { input: Number.NaN, raw: Number.NaN, rawText: "NaN", text: "NaN" },
  { input: Infinity, raw: Infinity, rawText: "Infinity", text: "Infinity" },
  { input: -Infinity, raw: -Infinity, rawText: "-Infinity", text: "-Infinity" }
];
function checkNumber(actual: number, expected: number, text: string, inverse?: number): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, inverse), true);
}
for (const sample of samples) {
  const slot: readonly number[] = [sample.input];
  const observed: number = slot[0];
  checkNumber(observed, sample.raw, sample.rawText, sample.inverse);
  const result: string = observed.toString(2);
  assert.sameValue(Object.is(result, sample.text), true); assert.sameValue(typeof result, "string");
  assert.sameValue(String(result), sample.text);
}
