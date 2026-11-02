/*---
description: "Control for powers-exponent-union-special-values; An input and return union preserve prescribed exponentiation results and numeric kinds."
features: [ts-math-routes, ts-math-route-powers-roots, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-iteration, ts-unions, ts-objects, ts-type-aliases]
---*/
// Primitive and boxed number unions pass power operands through narrowing; node logs the selected arm, operands and prescribed result before the union return. The control retains the route and selects the result by input position.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number, number][] = [
  [NaN, 0, 1], [NaN, -0, 1], [NaN, 1, NaN], [NaN, -1, NaN],
  [1, NaN, NaN], [0, NaN, NaN], [-0, NaN, NaN], [Infinity, NaN, NaN],
  [-Infinity, NaN, NaN], [NaN, NaN, NaN], [0, 0, 1], [-0, -0, 1],
  [Infinity, -0, 1], [-Infinity, 0, 1], [-2, -0, 1], [0, 3, 0],
  [0, -3, Infinity], [-0, 3, -0], [-0, -3, -Infinity], [-0, 2, 0],
  [-0, -2, Infinity], [-0, 0.5, 0], [-0, -0.5, Infinity], [-0, 1.5, 0],
  [-0, -2.5, Infinity], [-0, Infinity, 0], [-0, -Infinity, Infinity], [-0, 9007199254740991, -0],
  [-0, 9007199254740992, 0], [-0, 9007199254740994, 0], [-0, -9007199254740991, -Infinity], [-0, -9007199254740992, Infinity],
  [-0, 4294967297, -0], [-0, -2147483649, -Infinity], [Infinity, 3, Infinity], [Infinity, -3, 0],
  [-Infinity, 3, -Infinity], [-Infinity, -3, -0], [-Infinity, 2, Infinity], [-Infinity, -2, 0],
  [-Infinity, 0.5, Infinity], [-Infinity, -0.5, 0], [-Infinity, Infinity, Infinity], [-Infinity, -Infinity, 0],
  [1, Infinity, NaN], [-1, Infinity, NaN], [1, -Infinity, NaN], [-1, -Infinity, NaN],
  [2, Infinity, Infinity], [-2, Infinity, Infinity], [2, -Infinity, 0], [-2, -Infinity, 0],
  [0.5, Infinity, 0], [-0.5, Infinity, 0], [0.5, -Infinity, Infinity], [-0.5, -Infinity, Infinity],
  [5e-324, Infinity, 0], [-5e-324, -Infinity, Infinity], [1.7976931348623157e+308, Infinity, Infinity], [-1.7976931348623157e+308, -Infinity, 0],
  [-1, 0.5, NaN], [-8, -0.5, NaN], [-1.7976931348623157e+308, 1.5, NaN], [-5e-324, -2.5, NaN],
  [4503599627370496, 0, 1], [-4503599627370496, -0, 1], [2147483648, 0, 1], [4294967297, -0, 1],
  [1.0000000000000002, Infinity, Infinity], [0.9999999999999999, Infinity, 0], [-1.0000000000000002, -Infinity, 0], [-0.9999999999999999, -Infinity, Infinity],
  [-Infinity, 9007199254740991, -Infinity], [-Infinity, -9007199254740991, -0], [-Infinity, 9007199254740992, Infinity], [-Infinity, -9007199254740992, 0],
];
type PowerValue = number | { value: number };
function compute(input: PowerValue, exponent: number, position: number, log: unknown[]): PowerValue {
  let base: number; if (typeof input === "number") { base = input; log.push("number"); } else { base = input.value; log.push("box"); }
  log.push("input", base, exponent); const result = rows[position][2]; log.push("computed", result); return typeof input === "number" ? result : { value: result };
}
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], inputs: PowerValue[] = [row[0], { value: row[0] }];
  for (let arm = 0; arm < inputs.length; arm++) {
    const log: unknown[] = [], result = compute(inputs[arm], row[1], position, log);
    if (typeof result === "number") { same(arm, 0); same(result, row[2]); } else { same(arm, 1); same(result.value, row[2]); }
    exact(log, [arm === 0 ? "number" : "box", "input", row[0], row[1], "computed", row[2]]);
  }
}
