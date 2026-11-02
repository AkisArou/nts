/*---
description: "An interface-held Date returns canonical UTC ISO text and throws RangeError only for invalid time."
features: [ts-date-routes, ts-date-route-text, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-unions, ts-null-undefined, ts-errors, ts-arrow-functions, ts-closures]
---*/
// The same Date field reaches a string return across all year widths and TimeClip boundaries; node preserves its numeric value before and after formatting.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TextRow = { input: number; time: number; text: string | null };
const rows: TextRow[] = [
  { input: 0, time: 0, text: "1970-01-01T00:00:00.000Z" }, { input: -0.0, time: 0, text: "1970-01-01T00:00:00.000Z" },
  { input: -1, time: -1, text: "1969-12-31T23:59:59.999Z" }, { input: 951827696789, time: 951827696789, text: "2000-02-29T12:34:56.789Z" },
  { input: 1609459199999, time: 1609459199999, text: "2020-12-31T23:59:59.999Z" }, { input: -62167219200000, time: -62167219200000, text: "0000-01-01T00:00:00.000Z" },
  { input: -62198755200000, time: -62198755200000, text: "-000001-01-01T00:00:00.000Z" }, { input: 253402300799999, time: 253402300799999, text: "9999-12-31T23:59:59.999Z" },
  { input: 253402300800000, time: 253402300800000, text: "+010000-01-01T00:00:00.000Z" }, { input: -8640000000000000, time: -8640000000000000, text: "-271821-04-20T00:00:00.000Z" },
  { input: 8640000000000000, time: 8640000000000000, text: "+275760-09-13T00:00:00.000Z" }, { input: 1.9, time: 1, text: "1970-01-01T00:00:00.001Z" },
  { input: -1.9, time: -1, text: "1969-12-31T23:59:59.999Z" }, { input: NaN, time: NaN, text: null },
  { input: Infinity, time: NaN, text: null }, { input: -Infinity, time: NaN, text: null },
  { input: 8640000000000001, time: NaN, text: null }, { input: -8640000000000001, time: NaN, text: null }
];
interface ClockView { value: Date }
function render(clock: ClockView): string { return clock.value.toISOString(); }
for (const row of rows) {
  const clock: ClockView = { value: new Date(row.input) }, log: unknown[] = ["before", clock.value.getTime()], expected: unknown[] = ["before", row.time];
  if (row.text === null) { assert.throws(RangeError, () => { render(clock); }); log.push("throw", "RangeError"); expected.push("throw", "RangeError"); }
  else { const text = render(clock); log.push("iso", text); expected.push("iso", row.text); assert.sameValue(text, row.text); }
  log.push("after", clock.value.valueOf()); expected.push("after", row.time); exact(log, expected);
}
