/*---
description: "Bigint exponentiation through a generic method carrier preserves operand order, exact wide returns and RangeError."
features: [ts-type-form-routes, ts-type-form-route-values, ts-exponent, ts-interfaces, ts-generics, ts-generic-constraints, ts-objects, ts-tuples, ts-bigint, ts-strings, ts-errors, ts-arrow-functions, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// ** consumes two methods through a constrained generic; node logs both calls in order, returns exact powers beyond 64 bits and rejects every negative exponent.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
interface Operands { base(): bigint; exponent(): bigint; }
function calculate<T extends Operands>(input: T): bigint { return input.base() ** input.exponent(); }
function route(base: bigint, exponent: bigint): Operands {
  return { base(): bigint { log.push("base", base); return base; }, exponent(): bigint { log.push("exponent", exponent); return exponent; } };
}
const rows: [bigint, bigint, bigint][] = [
  [0n, 0n, 1n], [-3n, 3n, -27n], [-3n, 4n, 81n],
  [2n, 65n, 36893488147419103232n], [-2n, 65n, -36893488147419103232n]
];
for (const row of rows) {
  const input = route(row[0], row[1]); log.length = 0;
  same(calculate(input), row[2]); exact(log, ["base", row[0], "exponent", row[1]]);
}
for (const base of [0n, 1n, -2n]) for (const exponent of [-1n, -3n]) {
  const input = route(base, exponent); log.length = 0;
  assert.throws(RangeError, () => calculate(input)); exact(log, ["base", base, "exponent", exponent]);
}
