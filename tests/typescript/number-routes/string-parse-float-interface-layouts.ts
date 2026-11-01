/*---
description: parseFloat prefix parsing flows through an interface number property across two class layouts before further arithmetic.
features: [ts-number-route-strings, ts-numbers, ts-conversions, ts-class, ts-class-fields, ts-interfaces]
---*/
// Route: parseFloat prefix parsing -> an interface number property across two class layouts -> observed * 2; node preserves the raw number and the exact result, including signed-zero observations.
interface ParseSample { input: string; parsed: number; parsedText: string; result: number; resultText: string; parsedInverse?: number; resultInverse?: number; }
const samples: ParseSample[] = [
  { input: "1e3x", parsed: 1000, parsedText: "1000", result: 2000, resultText: "2000" },
  { input: "1.5px", parsed: 1.5, parsedText: "1.5", result: 3, resultText: "3" },
  { input: "08", parsed: 8, parsedText: "8", result: 16, resultText: "16" },
  { input: "1_000", parsed: 1, parsedText: "1", result: 2, resultText: "2" },
  { input: "0x10", parsed: 0, parsedText: "0", result: 0, resultText: "0", parsedInverse: Infinity, resultInverse: Infinity },
  { input: "-0suffix", parsed: -0, parsedText: "0", result: -0, resultText: "0", parsedInverse: -Infinity, resultInverse: -Infinity },
  { input: ".5tail", parsed: 0.5, parsedText: "0.5", result: 1, resultText: "1" },
  { input: "Infinityx", parsed: Infinity, parsedText: "Infinity", result: Infinity, resultText: "Infinity" },
  { input: "-Infinitytail", parsed: -Infinity, parsedText: "-Infinity", result: -Infinity, resultText: "-Infinity" },
  { input: "invalid", parsed: Number.NaN, parsedText: "NaN", result: Number.NaN, resultText: "NaN" },
  { input: "9007199254740993junk", parsed: 9007199254740992, parsedText: "9007199254740992", result: 18014398509481984, resultText: "18014398509481984" },
  { input: "5e-324tail", parsed: 5e-324, parsedText: "5e-324", result: 1e-323, resultText: "1e-323" },
  { input: "-5e-324tail", parsed: -5e-324, parsedText: "-5e-324", result: -1e-323, resultText: "-1e-323" }
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
  const parsed: number = parseFloat(sample.input);
  checkNumber(parsed, sample.parsed, sample.parsedText, sample.parsedInverse);
  const slot: NumericView = alternate ? new TrailingCarrier() : new LeadingCarrier();
  slot.value = parsed; const observed: number = slot.value;
  checkNumber(observed, sample.parsed, sample.parsedText, sample.parsedInverse);
  const result: number = observed * 2;
  checkNumber(result, sample.result, sample.resultText, sample.resultInverse);
}
