/*---
description: "Explicit conversion control: Two declared scalar fields retain their kinds while one template converts both values."
features: [ts-template-routes, ts-template-route-substitutions, ts-strings, ts-conversions, ts-arrays, ts-functions, ts-typeof-operator, ts-unknown, ts-class, ts-class-fields, ts-this, ts-type-aliases, ts-unions, ts-numbers, ts-bigint, ts-null-undefined, ts-tuples]
---*/
// Scalar class fields carry empty text, signed zeros, exponents, booleans, bigints and nullish values; node duplicates their exact text around a separator. The control uses ordered String calls and concatenation.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type Scalar = string | number | boolean | bigint | null | undefined;

const rows: [Scalar, string][] = [
  ["", ""], ["A", "A"], ["\ud83d\ude00", "\ud83d\ude00"], [0, "0"], [-0, "0"], [0.5, "0.5"], [-1.5, "-1.5"],
  [1e21, "1e+21"], [-1e21, "-1e+21"], [1e-7, "1e-7"], [-1e-7, "-1e-7"], [NaN, "NaN"], [Infinity, "Infinity"], [-Infinity, "-Infinity"],
  [true, "true"], [false, "false"], [null, "null"], [undefined, "undefined"], [0n, "0"], [-9n, "-9"], [9007199254740993n, "9007199254740993"],
];
class ScalarPair {
  left: Scalar; right: Scalar;
  constructor(value: Scalar) { this.left = value; this.right = value; }
}
const log: unknown[] = [], wanted: unknown[] = [];
function render(cell: ScalarPair, index: number): string {
  same(cell.left, rows[index][0]); same(cell.right, rows[index][0]);
  const text: string = String(cell.left) + "|" + String(cell.right);
  log.push(cell.left, cell.right, text); return text;
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index], cell = new ScalarPair(row[0]), expected = row[1] + "|" + row[1];
  assert.sameValue(render(cell, index), expected); same(cell.left, row[0]); same(cell.right, row[0]);
  wanted.push(row[0], row[0], expected);
}
assert.compareArray(log, wanted);
