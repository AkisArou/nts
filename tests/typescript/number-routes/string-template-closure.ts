/*---
description: Template interpolation observes a captured number updated before its closure returns.
features: [ts-number-route-strings, ts-numbers, ts-conversions, ts-functions, ts-function-types, ts-closures, ts-template-literals]
---*/
// Route: a captured number updated before its closure returns -> Template interpolation; node preserves the raw number and the exact result, including signed-zero observations.
interface FormatSample { input: number; raw: number; rawText: string; text: string; inverse?: number; }
const samples: FormatSample[] = [
  { input: 0, raw: 0, rawText: "0", text: "value=0", inverse: Infinity },
  { input: -0, raw: -0, rawText: "0", text: "value=0", inverse: -Infinity },
  { input: 2, raw: 1, rawText: "1", text: "value=1" },
  { input: 3, raw: 1.5, rawText: "1.5", text: "value=1.5" },
  { input: -3, raw: -1.5, rawText: "-1.5", text: "value=-1.5" },
  { input: 0.2 + 0.4, raw: 0.30000000000000004, rawText: "0.30000000000000004", text: "value=0.30000000000000004" },
  { input: 2e21, raw: 1e+21, rawText: "1e+21", text: "value=1e+21" },
  { input: 3e-7, raw: 1.5e-7, rawText: "1.5e-7", text: "value=1.5e-7" },
  { input: 2e-6, raw: 0.000001, rawText: "0.000001", text: "value=0.000001" },
  { input: 4294967296, raw: 2147483648, rawText: "2147483648", text: "value=2147483648" },
  { input: 18014398509481984, raw: 9007199254740992, rawText: "9007199254740992", text: "value=9007199254740992" },
  { input: Number.MIN_VALUE, raw: 0, rawText: "0", text: "value=0", inverse: Infinity },
  { input: -Number.MIN_VALUE, raw: -0, rawText: "0", text: "value=0", inverse: -Infinity },
  { input: Number.NaN, raw: Number.NaN, rawText: "NaN", text: "value=NaN" },
  { input: Infinity, raw: Infinity, rawText: "Infinity", text: "value=Infinity" },
  { input: -Infinity, raw: -Infinity, rawText: "-Infinity", text: "value=-Infinity" }
];
function captureNumber(input: number): () => number {
  let stored: number = 0; stored = input; return () => { stored = stored / 2; return stored; };
}
function checkNumber(actual: number, expected: number, text: string, inverse?: number): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, inverse), true);
}
for (const sample of samples) {
  const read: () => number = captureNumber(sample.input); const observed: number = read();
  checkNumber(observed, sample.raw, sample.rawText, sample.inverse);
  const result: string = `value=${observed}`;
  assert.sameValue(Object.is(result, sample.text), true); assert.sameValue(typeof result, "string");
  assert.sameValue(String(result), sample.text);
}
