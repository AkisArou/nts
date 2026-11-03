/*---
description: "Control for values-exponent-bigint-assignment; Bigint exponent assignment preserves target order, setter result semantics and unchanged state when a negative exponent throws."
features: [ts-type-form-routes, ts-type-form-route-values, ts-interfaces, ts-accessors, ts-objects, ts-tuples, ts-bigint, ts-strings, ts-errors, ts-arrow-functions, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// **= crosses a Route interface to a bigint accessor; node returns the power before a setter increment, and RangeError skips the setter without changing storage. The control saves the target and value once, uses a checked bigint multiplication loop, then writes only after the power succeeds.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
interface Cell { value: bigint; }
interface Route { cell(): Cell; exponent(): bigint; }
function power(base: bigint, exponent: bigint): bigint {
  if (exponent < 0n) throw new RangeError();
  let result = 1n; for (let i = 0n; i < exponent; i++) result *= base; return result;
}
function update(route: Route): bigint {
  const target = route.cell(), base = target.value, exponent = route.exponent();
  const result = power(base, exponent); target.value = result; return result;
}
const rows: [bigint, bigint, bigint][] = [
  [0n, 0n, 1n], [-3n, 3n, -27n], [-3n, 4n, 81n], [2n, 65n, 36893488147419103232n],
  [0n, -1n, 0n], [1n, -3n, 1n], [-2n, -1n, -2n]
];
for (const row of rows) {
  let stored = row[0];
  const cell: Cell = {
    get value(): bigint { log.push("get", stored); return stored; },
    set value(next: bigint) { log.push("set", next); stored = next + 1n; }
  };
  const route: Route = {
    cell(): Cell { log.push("cell"); return cell; },
    exponent(): bigint { log.push("exponent", row[1]); return row[1]; }
  };
  log.length = 0;
  if (row[1] < 0n) {
    assert.throws(RangeError, () => update(route)); same(stored, row[0]);
    exact(log, ["cell", "get", row[0], "exponent", row[1]]);
  } else {
    const result = update(route); same(result, row[2]); same(stored, row[2] + 1n);
    exact(log, ["cell", "get", row[0], "exponent", row[1], "set", row[2]]);
  }
}
