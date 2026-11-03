/*---
description: "Control for values-exponent-number-getters; Number exponentiation reads interface accessors once in order and returns exact special results."
features: [ts-type-form-routes, ts-type-form-route-values, ts-interfaces, ts-accessors, ts-objects, ts-tuples, ts-numbers, ts-strings, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// ** consumes an Operands interface parameter with logged getters; node reads base then exponent and returns signed zero, NaN, finite powers or signed infinity. The control calls Math.pow with the same ordered accessor arguments.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
interface Operands { base: number; exponent: number; }
function calculate(input: Operands): number { return Math.pow(input.base, input.exponent); }
const rows: [number, number, number][] = [
  [-2, 3, -8], [-2, 4, 16], [-0, 3, -0], [-0, 2, 0], [-0, -3, -Infinity],
  [NaN, 0, 1], [NaN, 2, NaN], [2, NaN, NaN], [1e308, 2, Infinity],
  [-1e308, 3, -Infinity], [-4, 0.5, NaN], [2, -3, 0.125]
];
for (const row of rows) {
  const input: Operands = {
    get base(): number { log.push("base", row[0]); return row[0]; },
    get exponent(): number { log.push("exponent", row[1]); return row[1]; }
  };
  log.length = 0; const result = calculate(input);
  same(result, row[2]); exact(log, ["base", row[0], "exponent", row[1]]);
}
