/*---
description: "Explicit conversion control: Typed tuple slots and logged scalar returns feed adjacent substitutions with empty literal segments."
features: [ts-template-routes, ts-template-route-substitutions, ts-strings, ts-conversions, ts-arrays, ts-functions, ts-typeof-operator, ts-unknown, ts-type-aliases, ts-unions, ts-numbers, ts-bigint, ts-null-undefined, ts-tuples, ts-readonly, ts-literal-types]
---*/
// A readonly scalar tuple enters two typed readers; node reads left then right and joins their exact text without inserting separators. The control uses ordered String calls and concatenation.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type Scalar = string | number | boolean | bigint | null | undefined;

const rows: [readonly [Scalar, Scalar], string][] = [
  [["", ""], ""], [["", "x"], "x"], [[-0, ""], "0"], [[null, undefined], "nullundefined"],
  [[NaN, 1e-7], "NaN1e-7"], [[1e21, false], "1e+21false"], [[true, 12n], "true12"], [[9007199254740993n, -0], "90071992547409930"],
];
const log: unknown[] = [], wanted: unknown[] = [];
function take(value: Scalar, side: "left" | "right"): Scalar { log.push(side, value); return value; }
function render(values: readonly [Scalar, Scalar]): string {
  return String(take(values[0], "left")) + String(take(values[1], "right"));
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index], values: readonly [Scalar, Scalar] = row[0];
  assert.sameValue(render(values), row[1]); same(values[0], row[0][0]); same(values[1], row[0][1]);
  wanted.push("left", row[0][0], "right", row[0][1]);
}
assert.compareArray(log, wanted);
