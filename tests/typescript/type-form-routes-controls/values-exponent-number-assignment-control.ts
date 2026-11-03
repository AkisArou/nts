/*---
description: "Control for values-exponent-number-assignment; Number exponent assignment evaluates its target once and returns the power before setter transformation."
features: [ts-type-form-routes, ts-type-form-route-values, ts-interfaces, ts-accessors, ts-objects, ts-tuples, ts-numbers, ts-strings, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// **= crosses a Route interface to an accessor; node calls cell/get/exponent/set once each and returns the computed power while the setter stores its negation. The control saves the target and getter value once, computes Math.pow, performs one setter call and returns the computed result.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
interface Cell { value: number; }
interface Route { cell(): Cell; exponent(): number; }
function update(route: Route): number {
  const target = route.cell(), base = target.value, exponent = route.exponent();
  const result = Math.pow(base, exponent); target.value = result; return result;
}
const rows: [number, number, number][] = [
  [-2, 3, -8], [-2, 4, 16], [-0, 3, -0], [-0, 2, 0], [-0, -3, -Infinity],
  [NaN, 0, 1], [NaN, 2, NaN], [2, NaN, NaN], [1e308, 2, Infinity],
  [-1e308, 3, -Infinity], [-4, 0.5, NaN], [2, -3, 0.125]
];
for (const row of rows) {
  let stored = row[0];
  const cell: Cell = {
    get value(): number { log.push("get", stored); return stored; },
    set value(next: number) { log.push("set", next); stored = -next; }
  };
  const route: Route = {
    cell(): Cell { log.push("cell"); return cell; },
    exponent(): number { log.push("exponent", row[1]); return row[1]; }
  };
  log.length = 0; const result = update(route);
  same(result, row[2]); same(stored, -row[2]);
  exact(log, ["cell", "get", row[0], "exponent", row[1], "set", row[2]]);
}
