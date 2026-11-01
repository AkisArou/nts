/*---
description: Control for string-number-interface-layouts; the same conversion and arithmetic use plain number locals.
features: [ts-number-route-strings, ts-numbers, ts-conversions, ts-class, ts-class-fields, ts-interfaces]
---*/
// Control: ../number-routes/string-number-interface-layouts.ts; replace only the numeric carrier with plain number locals.
interface ParseSample { input: string; parsed: number; parsedText: string; result: number; resultText: string; parsedInverse?: number; resultInverse?: number; }
const samples: ParseSample[] = [
  { input: "", parsed: 0, parsedText: "0", result: 0, resultText: "0", parsedInverse: Infinity, resultInverse: Infinity },
  { input: " \t\n ", parsed: 0, parsedText: "0", result: 0, resultText: "0", parsedInverse: Infinity, resultInverse: Infinity },
  { input: " 12 ", parsed: 12, parsedText: "12", result: 6, resultText: "6" },
  { input: "-0", parsed: -0, parsedText: "0", result: -0, resultText: "0", parsedInverse: -Infinity, resultInverse: -Infinity },
  { input: "1.5", parsed: 1.5, parsedText: "1.5", result: 0.75, resultText: "0.75" },
  { input: "0.1", parsed: 0.1, parsedText: "0.1", result: 0.05, resultText: "0.05" },
  { input: "0.30000000000000004", parsed: 0.30000000000000004, parsedText: "0.30000000000000004", result: 0.15000000000000002, resultText: "0.15000000000000002" },
  { input: "9007199254740993", parsed: 9007199254740992, parsedText: "9007199254740992", result: 4503599627370496, resultText: "4503599627370496" },
  { input: "1e21", parsed: 1e+21, parsedText: "1e+21", result: 500000000000000000000, resultText: "500000000000000000000" },
  { input: "1.5e-7", parsed: 1.5e-7, parsedText: "1.5e-7", result: 7.5e-8, resultText: "7.5e-8" },
  { input: "5e-324", parsed: 5e-324, parsedText: "5e-324", result: 0, resultText: "0", resultInverse: Infinity },
  { input: "-5e-324", parsed: -5e-324, parsedText: "-5e-324", result: -0, resultText: "0", resultInverse: -Infinity },
  { input: "1e309", parsed: Infinity, parsedText: "Infinity", result: Infinity, resultText: "Infinity" },
  { input: "-Infinity", parsed: -Infinity, parsedText: "-Infinity", result: -Infinity, resultText: "-Infinity" },
  { input: "1_000", parsed: Number.NaN, parsedText: "NaN", result: Number.NaN, resultText: "NaN" },
  { input: "12x", parsed: Number.NaN, parsedText: "NaN", result: Number.NaN, resultText: "NaN" }
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
  const parsed: number = Number(sample.input);
  checkNumber(parsed, sample.parsed, sample.parsedText, sample.parsedInverse);
  let slot: number = 0;
  slot = parsed; const observed: number = slot;
  checkNumber(observed, sample.parsed, sample.parsedText, sample.parsedInverse);
  const result: number = observed / 2;
  checkNumber(result, sample.result, sample.resultText, sample.resultInverse);
}
