/*---
description: Control for string-parse-int-generic; the same conversion and arithmetic use plain number locals.
features: [ts-number-route-strings, ts-numbers, ts-conversions, ts-class, ts-class-fields, ts-generics]
---*/
// Control: ../number-routes/string-parse-int-generic.ts; replace only the numeric carrier with plain number locals.
interface ParseSample { input: string; parsed: number; parsedText: string; result: number; resultText: string; parsedInverse?: number; resultInverse?: number; }
const samples: ParseSample[] = [
  { input: "08", parsed: 8, parsedText: "8", result: 4, resultText: "4" },
  { input: "010", parsed: 10, parsedText: "10", result: 5, resultText: "5" },
  { input: "-0", parsed: -0, parsedText: "0", result: -0, resultText: "0", parsedInverse: -Infinity, resultInverse: -Infinity },
  { input: "1e3", parsed: 1, parsedText: "1", result: 0.5, resultText: "0.5" },
  { input: "1_000", parsed: 1, parsedText: "1", result: 0.5, resultText: "0.5" },
  { input: "12px", parsed: 12, parsedText: "12", result: 6, resultText: "6" },
  { input: "", parsed: Number.NaN, parsedText: "NaN", result: Number.NaN, resultText: "NaN" },
  { input: "  -15rest", parsed: -15, parsedText: "-15", result: -7.5, resultText: "-7.5" },
  { input: "0x10", parsed: 16, parsedText: "16", result: 8, resultText: "8" },
  { input: "9007199254740993junk", parsed: 9007199254740992, parsedText: "9007199254740992", result: 4503599627370496, resultText: "4503599627370496" }
];
class NumericCarrier<T> { value: T; constructor(value: T) { this.value = value; } }
function checkNumber(actual: number, expected: number, text: string, inverse?: number): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, inverse), true);
}
for (const sample of samples) {
  const parsed: number = parseInt(sample.input);
  checkNumber(parsed, sample.parsed, sample.parsedText, sample.parsedInverse);
  let slot: number = 0; slot = parsed;
  const observed: number = slot;
  checkNumber(observed, sample.parsed, sample.parsedText, sample.parsedInverse);
  const result: number = observed / 2;
  checkNumber(result, sample.result, sample.resultText, sample.resultInverse);
}
