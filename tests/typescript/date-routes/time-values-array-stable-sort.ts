/*---
description: "A Date array sorts by numeric time with stable equal-time identities and explicitly ordered invalid values."
features: [ts-date-routes, ts-date-route-time-values, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator]
---*/
// Date array elements reach a pure valueOf comparator; input and output logs retain every time and original identity index. Node orders finite times, keeps equal times stable and places invalid values last.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type SortSample = [number[], number[], number[]];
const samples: SortSample[] = [
  [[], [], []], [[0], [0], [0]],
  [[0, -1, 1, -0, NaN, 999], [0, -1, 1, 0, NaN, 999], [1, 0, 3, 2, 5, 4]],
  [[8640000000000000, -8640000000000000, 253402300799999, -62167219200000, -62198755200000, 253402300800000, NaN],
   [8640000000000000, -8640000000000000, 253402300799999, -62167219200000, -62198755200000, 253402300800000, NaN], [1, 4, 3, 2, 5, 0, 6]],
  [[951827696789, 946684799999, 951827696789, NaN, NaN], [951827696789, 946684799999, 951827696789, NaN, NaN], [1, 0, 2, 3, 4]],
  [[-0.75, 0.75, -1.75, 1.75, Infinity, -Infinity], [0, 0, -1, 1, NaN, NaN], [2, 0, 1, 3, 4, 5]],
];
function compare(left: Date, right: Date): number {
  const a = left.valueOf(), b = right.valueOf(); if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : 1;
  if (Number.isNaN(b)) return -1; return a - b;
}
function inspect(sample: SortSample): void {
  const values: Date[] = []; for (const input of sample[0]) values.push(new Date(input));
  const originals = values.slice(), log: unknown[] = [], expected: unknown[] = [];
  for (let i = 0; i < values.length; i++) { log.push("input", i, values[i].getTime()); expected.push("input", i, sample[1][i]); }
  same(values.sort(compare), values); same(values.length, sample[2].length);
  for (let i = 0; i < values.length; i++) {
    const wanted = sample[2][i]; same(values[i], originals[wanted]);
    log.push("sorted", i, originals.indexOf(values[i]), values[i].getTime(), values[i].valueOf()); expected.push("sorted", i, wanted, sample[1][wanted], sample[1][wanted]);
  }
  exact(log, expected); for (let i = 0; i < originals.length; i++) same(originals[i].getTime(), sample[1][i]);
}
for (const sample of samples) inspect(sample);
