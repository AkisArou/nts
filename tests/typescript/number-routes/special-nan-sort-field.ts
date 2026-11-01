/*---
description: Numeric comparator differences cross a typed field before sort treats NaN as equality.
features: [ts-number-route-zero-nan, ts-numbers, ts-arrays, ts-objects, ts-functions]
---*/
// Route: a numeric comparator stores its difference in a typed field; node treats its NaN as a stable tie.
const rows: { a: number; b: number; first: number; second: number; difference: number; trace: string; text: string; diffNegative: boolean; firstNegative: boolean; secondNegative: boolean }[] = [
  { a: 2, b: 1, first: 1, second: 2, difference: -1, trace: "1:2:-1", text: "1|2", diffNegative: false, firstNegative: false, secondNegative: false },
  { a: 1, b: NaN, first: 1, second: NaN, difference: NaN, trace: "NaN:1:NaN", text: "1|NaN", diffNegative: false, firstNegative: false, secondNegative: false },
  { a: NaN, b: 1, first: NaN, second: 1, difference: NaN, trace: "1:NaN:NaN", text: "NaN|1", diffNegative: false, firstNegative: false, secondNegative: false },
  { a: -0, b: 0, first: -0, second: 0, difference: 0, trace: "0:0:0", text: "0|0", diffNegative: false, firstNegative: true, secondNegative: false },
  { a: 0, b: -0, first: 0, second: -0, difference: -0, trace: "0:0:0", text: "0|0", diffNegative: true, firstNegative: false, secondNegative: true },
  { a: 2 ** 31, b: 2 ** 31 - 1, first: 2147483647, second: 2147483648, difference: -1, trace: "2147483647:2147483648:-1", text: "2147483647|2147483648", diffNegative: false, firstNegative: false, secondNegative: false },
  { a: 2 ** 32, b: -0, first: -0, second: 4294967296, difference: -4294967296, trace: "0:4294967296:-4294967296", text: "0|4294967296", diffNegative: false, firstNegative: true, secondNegative: false },
  { a: 2 ** 53 + 2, b: 2 ** 53, first: 9007199254740992, second: 9007199254740994, difference: -2, trace: "9007199254740992:9007199254740994:-2", text: "9007199254740992|9007199254740994", diffNegative: false, firstNegative: false, secondNegative: false },
  { a: 1.5, b: -0.5, first: -0.5, second: 1.5, difference: -2, trace: "-0.5:1.5:-2", text: "-0.5|1.5", diffNegative: false, firstNegative: false, secondNegative: false },
  { a: Infinity, b: Infinity, first: Infinity, second: Infinity, difference: NaN, trace: "Infinity:Infinity:NaN", text: "Infinity|Infinity", diffNegative: false, firstNegative: false, secondNegative: false },
  { a: Infinity, b: -Infinity, first: -Infinity, second: Infinity, difference: -Infinity, trace: "-Infinity:Infinity:-Infinity", text: "-Infinity|Infinity", diffNegative: false, firstNegative: false, secondNegative: false },
  { a: -Infinity, b: NaN, first: -Infinity, second: NaN, difference: NaN, trace: "NaN:-Infinity:NaN", text: "-Infinity|NaN", diffNegative: false, firstNegative: false, secondNegative: false },
];
for (const row of rows) {
  const values: number[] = [row.a, row.b];
  const trace: string[] = [];
  const result = values.sort((left: number, right: number): number => {
    assert.sameValue(Object.is(left, row.b), true);
    assert.sameValue(Object.is(right, row.a), true);
    const cell: { amount: number } = { amount: left - right };
    const actual: number = cell.amount;
    assert.sameValue(Object.is(actual, row.difference), true);
    assert.sameValue(typeof actual, "number");
    if (actual === 0) assert.sameValue(Object.is(1 / actual, row.diffNegative ? -Infinity : Infinity), true);
    trace.push(String(left) + ":" + String(right) + ":" + String(actual));
    return actual;
  });
  assert.compareArray(trace, [row.trace]);
  assert.sameValue(result, values);
  assert.sameValue(result.length, 2);
  assert.sameValue(Object.is(result[0], row.first), true);
  assert.sameValue(Object.is(result[1], row.second), true);
  assert.sameValue(typeof result[0], "number");
  assert.sameValue(typeof result[1], "number");
  assert.sameValue(String(result[0]) + "|" + String(result[1]), row.text);
  if (result[0] === 0) assert.sameValue(Object.is(1 / result[0], row.firstNegative ? -Infinity : Infinity), true);
  if (result[1] === 0) assert.sameValue(Object.is(1 / result[1], row.secondNegative ? -Infinity : Infinity), true);
}
