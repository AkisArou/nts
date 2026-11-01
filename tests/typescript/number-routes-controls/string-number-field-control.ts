/*---
description: Control for string-number-field; the same conversion and arithmetic use plain number locals.
features: [ts-number-route-strings, ts-numbers, ts-conversions, ts-class, ts-class-fields]
---*/
// Control: ../number-routes/string-number-field.ts; replace only the numeric carrier with plain number locals.
interface ParseSample { input: string; parsed: number; parsedText: string; result: number; resultText: string; parsedInverse?: number; resultInverse?: number; }
const samples: ParseSample[] = [
  { input: "", parsed: 0, parsedText: "0", result: 0, resultText: "0", parsedInverse: Infinity, resultInverse: Infinity },
  { input: " \t\n ", parsed: 0, parsedText: "0", result: 0, resultText: "0", parsedInverse: Infinity, resultInverse: Infinity },
  { input: " 12 ", parsed: 12, parsedText: "12", result: 24, resultText: "24" },
  { input: "-0", parsed: -0, parsedText: "0", result: -0, resultText: "0", parsedInverse: -Infinity, resultInverse: -Infinity },
  { input: "1.5", parsed: 1.5, parsedText: "1.5", result: 3, resultText: "3" },
  { input: "0.1", parsed: 0.1, parsedText: "0.1", result: 0.2, resultText: "0.2" },
  { input: "0.30000000000000004", parsed: 0.30000000000000004, parsedText: "0.30000000000000004", result: 0.6000000000000001, resultText: "0.6000000000000001" },
  { input: "9007199254740993", parsed: 9007199254740992, parsedText: "9007199254740992", result: 18014398509481984, resultText: "18014398509481984" },
  { input: "1e21", parsed: 1e+21, parsedText: "1e+21", result: 2e+21, resultText: "2e+21" },
  { input: "1.5e-7", parsed: 1.5e-7, parsedText: "1.5e-7", result: 3e-7, resultText: "3e-7" },
  { input: "5e-324", parsed: 5e-324, parsedText: "5e-324", result: 1e-323, resultText: "1e-323" },
  { input: "-5e-324", parsed: -5e-324, parsedText: "-5e-324", result: -1e-323, resultText: "-1e-323" },
  { input: "1e309", parsed: Infinity, parsedText: "Infinity", result: Infinity, resultText: "Infinity" },
  { input: "-Infinity", parsed: -Infinity, parsedText: "-Infinity", result: -Infinity, resultText: "-Infinity" },
  { input: "1_000", parsed: Number.NaN, parsedText: "NaN", result: Number.NaN, resultText: "NaN" },
  { input: "12x", parsed: Number.NaN, parsedText: "NaN", result: Number.NaN, resultText: "NaN" }
];
class NumericCarrier { value: number = 0; }
function checkNumber(actual: number, expected: number, text: string, inverse?: number): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, inverse), true);
}
for (const sample of samples) {
  const parsed: number = Number(sample.input);
  checkNumber(parsed, sample.parsed, sample.parsedText, sample.parsedInverse);
  let slot: number = 0; slot = parsed;
  const observed: number = slot;
  checkNumber(observed, sample.parsed, sample.parsedText, sample.parsedInverse);
  const result: number = observed * 2;
  checkNumber(result, sample.result, sample.resultText, sample.resultInverse);
}
