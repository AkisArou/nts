/*---
description: "A class numeric field reaches inverse cosine at its exact +1 boundary and outside the domain, with the original field retained."
features: [ts-math-routes, ts-math-route-trigonometry, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-objects, ts-class, ts-class-fields]
---*/
// A class number field logs input and inverse-cosine result; Node maps one to positive zero and out-of-domain inputs or NaN to NaN.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TrigRow = { input: number; expected: number };
const rows: TrigRow[] = [
  { input: 1, expected: 0 }, { input: NaN, expected: NaN },
  { input: 1.0000000000000002, expected: NaN }, { input: -1.0000000000000002, expected: NaN },
  { input: 2, expected: NaN }, { input: -2, expected: NaN },
  { input: 9007199254740991, expected: NaN }, { input: -9007199254740991, expected: NaN },
  { input: Infinity, expected: NaN }, { input: -Infinity, expected: NaN },
];
class TrigValue {
  value: number;
  constructor(value: number) { this.value = value; }
  evaluate(position: number, log: unknown[]): number {
    const input: number = this.value; same(input, rows[position].input); log.push("input", input);
    const result: number = Math.acos(input); log.push("result", result); return result;
  }
}
let position = 0;
for (const row of rows) {
  const source = new TrigValue(row.input), log: unknown[] = [], result: number = source.evaluate(position, log);
  same(result, row.expected); same(source.value, row.input); exact(log, ["input", row.input, "result", row.expected]); position++;
}
same(position, rows.length);
