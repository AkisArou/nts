/*---
description: "Control for values-expando-interface-field; An inferred function expando and its callable interface field share property writes and call state."
features: [ts-type-form-routes, ts-type-form-route-values, ts-call-signatures, ts-interfaces, ts-objects, ts-tuples, ts-numbers, ts-strings, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// A function expando crosses Holder.run; node sees factor writes on the original function and last-argument writes made by the stored callable. The control constructs an explicitly declared Scaler callable object with Object.assign instead of inferring properties from expando assignments.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
const scale: Scaler = Object.assign(function(value: number): number { log.push("call", value, scale.factor); scale.last = value; return value * scale.factor; }, { factor: 1, last: 0 });
interface Scaler { (value: number): number; factor: number; last: number; }
interface Holder { run: Scaler; }
const holder: Holder = { run: scale };
const rows: [number, number, number][] = [[-0, 2, -0], [3, -2, -6], [0.5, 0.5, 0.25], [NaN, 0, NaN]];
for (const row of rows) {
  holder.run.factor = row[1]; log.length = 0;
  const result = holder.run(row[0]);
  same(result, row[2]); same(scale.last, row[0]); same(holder.run.last, row[0]); same(scale.factor, row[1]);
  same(holder.run, scale); same(typeof holder.run, "function"); exact(log, ["call", row[0], row[1]]);
}
