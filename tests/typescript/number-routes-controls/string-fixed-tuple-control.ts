/*---
description: Control for string-fixed-tuple; the same conversion and arithmetic use plain number locals.
features: [ts-number-route-strings, ts-numbers, ts-conversions, ts-tuples]
---*/
// Control: ../number-routes/string-fixed-tuple.ts; replace only the numeric carrier with plain number locals.
interface FormatSample { input: number; raw: number; rawText: string; text: string; inverse?: number; }
const samples: FormatSample[] = [
  { input: 0, raw: 0, rawText: "0", text: "0.000", inverse: Infinity },
  { input: -0, raw: -0, rawText: "0", text: "0.000", inverse: -Infinity },
  { input: 7, raw: 7, rawText: "7", text: "7.000" },
  { input: 1.5, raw: 1.5, rawText: "1.5", text: "1.500" },
  { input: -1.5, raw: -1.5, rawText: "-1.5", text: "-1.500" },
  { input: 1.005, raw: 1.005, rawText: "1.005", text: "1.005" },
  { input: 2.675, raw: 2.675, rawText: "2.675", text: "2.675" },
  { input: 0.1 + 0.2, raw: 0.30000000000000004, rawText: "0.30000000000000004", text: "0.300" },
  { input: 1.5e-7, raw: 1.5e-7, rawText: "1.5e-7", text: "0.000" },
  { input: -1.5e-7, raw: -1.5e-7, rawText: "-1.5e-7", text: "-0.000" },
  { input: 1e20, raw: 100000000000000000000, rawText: "100000000000000000000", text: "100000000000000000000.000" },
  { input: 1e21, raw: 1e+21, rawText: "1e+21", text: "1e+21" },
  { input: 9007199254740991, raw: 9007199254740991, rawText: "9007199254740991", text: "9007199254740991.000" },
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
  let slot: number = 0; slot = sample.input;
  const observed: number = slot;
  checkNumber(observed, sample.raw, sample.rawText, sample.inverse);
  const result: string = observed.toFixed(3);
  assert.sameValue(Object.is(result, sample.text), true); assert.sameValue(typeof result, "string");
  assert.sameValue(String(result), sample.text);
}
