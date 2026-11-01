/*---
description: Control for string-radix-binary-return; the same conversion and arithmetic use plain number locals.
features: [ts-number-route-strings, ts-numbers, ts-conversions, ts-functions]
---*/
// Control: ../number-routes/string-radix-binary-return.ts; replace only the numeric carrier with plain number locals.
interface FormatSample { input: number; raw: number; rawText: string; text: string; inverse?: number; }
const samples: FormatSample[] = [
  { input: 0, raw: 0, rawText: "0", text: "0", inverse: Infinity },
  { input: -0, raw: -0, rawText: "0", text: "0", inverse: -Infinity },
  { input: 2, raw: 1, rawText: "1", text: "1" },
  { input: 3, raw: 1.5, rawText: "1.5", text: "1.1" },
  { input: -3, raw: -1.5, rawText: "-1.5", text: "-1.1" },
  { input: 0.2 + 0.4, raw: 0.30000000000000004, rawText: "0.30000000000000004", text: "0.0100110011001100110011001100110011001100110011001101" },
  { input: 2e21, raw: 1e+21, rawText: "1e+21", text: "1101100011010111001001101011011100010111011110101000000000000000000000" },
  { input: 3e-7, raw: 1.5e-7, rawText: "1.5e-7", text: "0.00000000000000000000001010000100001111101011111010000001101100000110111011" },
  { input: 2e-6, raw: 0.000001, rawText: "0.000001", text: "0.000000000000000000010000110001101111011110100000101101011110110110001101" },
  { input: 4294967296, raw: 2147483648, rawText: "2147483648", text: "10000000000000000000000000000000" },
  { input: 18014398509481984, raw: 9007199254740992, rawText: "9007199254740992", text: "100000000000000000000000000000000000000000000000000000" },
  { input: Number.NaN, raw: Number.NaN, rawText: "NaN", text: "NaN" },
  { input: Infinity, raw: Infinity, rawText: "Infinity", text: "Infinity" },
  { input: -Infinity, raw: -Infinity, rawText: "-Infinity", text: "-Infinity" }
];
function throughParameter(value: number): number { return value / 2; }
function checkNumber(actual: number, expected: number, text: string, inverse?: number): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, inverse), true);
}
for (const sample of samples) {
  const local: number = sample.input; const observed: number = local / 2;
  checkNumber(observed, sample.raw, sample.rawText, sample.inverse);
  const result: string = observed.toString(2);
  assert.sameValue(Object.is(result, sample.text), true); assert.sameValue(typeof result, "string");
  assert.sameValue(String(result), sample.text);
}
