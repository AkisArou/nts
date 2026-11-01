/*---
description: Unary plus parsing flows through a readonly numeric tuple slot before further arithmetic.
features: [ts-number-route-strings, ts-numbers, ts-conversions, ts-tuples, ts-readonly]
---*/
// Route: Unary plus parsing -> a readonly numeric tuple slot -> observed / 2; node preserves the raw number and the exact result, including signed-zero observations.
interface ParseSample { input: string; parsed: number; parsedText: string; result: number; resultText: string; parsedInverse?: number; resultInverse?: number; }
const samples: ParseSample[] = [
  { input: "0x10", parsed: 16, parsedText: "16", result: 8, resultText: "8" },
  { input: "0xff", parsed: 255, parsedText: "255", result: 127.5, resultText: "127.5" },
  { input: "0b11", parsed: 3, parsedText: "3", result: 1.5, resultText: "1.5" },
  { input: "0o10", parsed: 8, parsedText: "8", result: 4, resultText: "4" },
  { input: "0x1fffffffffffff", parsed: 9007199254740991, parsedText: "9007199254740991", result: 4503599627370495.5, resultText: "4503599627370495.5" },
  { input: "0x20000000000001", parsed: 9007199254740992, parsedText: "9007199254740992", result: 4503599627370496, resultText: "4503599627370496" },
  { input: "-0", parsed: -0, parsedText: "0", result: -0, resultText: "0", parsedInverse: -Infinity, resultInverse: -Infinity },
  { input: " 0x20 ", parsed: 32, parsedText: "32", result: 16, resultText: "16" },
  { input: "-0x10", parsed: Number.NaN, parsedText: "NaN", result: Number.NaN, resultText: "NaN" },
  { input: "0x1.8", parsed: Number.NaN, parsedText: "NaN", result: Number.NaN, resultText: "NaN" },
  { input: "0x", parsed: Number.NaN, parsedText: "NaN", result: Number.NaN, resultText: "NaN" },
  { input: "Infinity", parsed: Infinity, parsedText: "Infinity", result: Infinity, resultText: "Infinity" },
  { input: "-Infinity", parsed: -Infinity, parsedText: "-Infinity", result: -Infinity, resultText: "-Infinity" }
];
function checkNumber(actual: number, expected: number, text: string, inverse?: number): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, inverse), true);
}
for (const sample of samples) {
  const parsed: number = +sample.input;
  checkNumber(parsed, sample.parsed, sample.parsedText, sample.parsedInverse);
  const slot: readonly [number, string] = [parsed, "numeric"];
  const observed: number = slot[0];
  checkNumber(observed, sample.parsed, sample.parsedText, sample.parsedInverse);
  const result: number = observed / 2;
  checkNumber(result, sample.result, sample.resultText, sample.resultInverse);
}
