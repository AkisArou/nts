/*---
description: Control for string-parse-int-closure; the same conversion and arithmetic use plain number locals.
features: [ts-number-route-strings, ts-numbers, ts-conversions, ts-functions, ts-function-types, ts-closures]
---*/
// Control: ../number-routes/string-parse-int-closure.ts; replace only the numeric carrier with plain number locals.
interface ParseSample { input: string; parsed: number; parsedText: string; result: number; resultText: string; parsedInverse?: number; resultInverse?: number; radix: number; }
const samples: ParseSample[] = [
  { input: "08", parsed: 8, parsedText: "8", result: 4, resultText: "4", radix: 10 },
  { input: "0x10", parsed: 0, parsedText: "0", result: 0, resultText: "0", parsedInverse: Infinity, resultInverse: Infinity, radix: 10 },
  { input: "-0x10", parsed: -0, parsedText: "0", result: -0, resultText: "0", parsedInverse: -Infinity, resultInverse: -Infinity, radix: 10 },
  { input: "fftail", parsed: 255, parsedText: "255", result: 127.5, resultText: "127.5", radix: 16 },
  { input: "101tail", parsed: 5, parsedText: "5", result: 2.5, resultText: "2.5", radix: 2 },
  { input: "z!", parsed: 35, parsedText: "35", result: 17.5, resultText: "17.5", radix: 36 },
  { input: "7.5", parsed: 7, parsedText: "7", result: 3.5, resultText: "3.5", radix: 10 },
  { input: "-15rest", parsed: -15, parsedText: "-15", result: -7.5, resultText: "-7.5", radix: 10 },
  { input: "", parsed: Number.NaN, parsedText: "NaN", result: Number.NaN, resultText: "NaN", radix: 10 },
  { input: "1fffffffffffff", parsed: 9007199254740991, parsedText: "9007199254740991", result: 4503599627370495.5, resultText: "4503599627370495.5", radix: 16 }
];
function captureNumber(input: number): () => number {
  let stored: number = 0; stored = input; return () => stored;
}
function checkNumber(actual: number, expected: number, text: string, inverse?: number): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, inverse), true);
}
for (const sample of samples) {
  const parsed: number = parseInt(sample.input, sample.radix);
  checkNumber(parsed, sample.parsed, sample.parsedText, sample.parsedInverse);
  let stored: number = 0; stored = parsed; const observed: number = stored;
  checkNumber(observed, sample.parsed, sample.parsedText, sample.parsedInverse);
  const result: number = observed / 2;
  checkNumber(result, sample.result, sample.resultText, sample.resultInverse);
}
