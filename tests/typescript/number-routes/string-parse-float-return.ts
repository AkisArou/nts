/*---
description: parseFloat prefix parsing flows through a numeric parameter and declared number return before further arithmetic.
features: [ts-number-route-strings, ts-numbers, ts-conversions, ts-functions]
---*/
// Route: parseFloat prefix parsing -> a numeric parameter and declared number return -> observed / 2; node preserves the raw number and the exact result, including signed-zero observations.
interface ParseSample { input: string; parsed: number; parsedText: string; result: number; resultText: string; parsedInverse?: number; resultInverse?: number; }
const samples: ParseSample[] = [
  { input: "1e3x", parsed: 1000, parsedText: "1000", result: 500, resultText: "500" },
  { input: "1.5px", parsed: 1.5, parsedText: "1.5", result: 0.75, resultText: "0.75" },
  { input: "08", parsed: 8, parsedText: "8", result: 4, resultText: "4" },
  { input: "1_000", parsed: 1, parsedText: "1", result: 0.5, resultText: "0.5" },
  { input: "0x10", parsed: 0, parsedText: "0", result: 0, resultText: "0", parsedInverse: Infinity, resultInverse: Infinity },
  { input: "-0suffix", parsed: -0, parsedText: "0", result: -0, resultText: "0", parsedInverse: -Infinity, resultInverse: -Infinity },
  { input: ".5tail", parsed: 0.5, parsedText: "0.5", result: 0.25, resultText: "0.25" },
  { input: "Infinityx", parsed: Infinity, parsedText: "Infinity", result: Infinity, resultText: "Infinity" },
  { input: "-Infinitytail", parsed: -Infinity, parsedText: "-Infinity", result: -Infinity, resultText: "-Infinity" },
  { input: "invalid", parsed: Number.NaN, parsedText: "NaN", result: Number.NaN, resultText: "NaN" },
  { input: "9007199254740993junk", parsed: 9007199254740992, parsedText: "9007199254740992", result: 4503599627370496, resultText: "4503599627370496" },
  { input: "5e-324tail", parsed: 5e-324, parsedText: "5e-324", result: 0, resultText: "0", resultInverse: Infinity },
  { input: "-5e-324tail", parsed: -5e-324, parsedText: "-5e-324", result: -0, resultText: "0", resultInverse: -Infinity }
];
function returnNumber(value: number): number { return value; }
function checkNumber(actual: number, expected: number, text: string, inverse?: number): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, inverse), true);
}
for (const sample of samples) {
  const parsed: number = parseFloat(sample.input);
  checkNumber(parsed, sample.parsed, sample.parsedText, sample.parsedInverse);
  const observed: number = returnNumber(parsed);
  checkNumber(observed, sample.parsed, sample.parsedText, sample.parsedInverse);
  const result: number = observed / 2;
  checkNumber(result, sample.result, sample.resultText, sample.resultInverse);
}
