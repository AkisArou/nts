/*---
description: A non-null find result crosses a generic return while absent matches and complete predicate histories remain observable.
features: [ts-type-form-routes, ts-type-form-route-claims, ts-non-null, ts-generics, ts-functions, ts-function-types, ts-interfaces, ts-arrays, ts-tuples, ts-iteration, ts-numbers, ts-objects, ts-null-undefined, ts-unions, ts-unknown, ts-typeof-operator, ts-errors]
---*/
// A find non-null claim crosses a generic return; node returns undefined on no match, retains the matching object, and stops the predicate at that match.
function same(actual: unknown, expected: unknown) { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
interface Entry { id: number; }
function locate<T>(values: T[], predicate: (value: T, index: number) => boolean): T {
  return values.find(predicate)!;
}
const first: Entry = { id: 1 }, second: Entry = { id: 2 }, values: Entry[] = [first, second];
const rows: [number, Entry | undefined, number[]][] = [
  [0, undefined, [0, 1]], [1, first, [0]], [2, second, [0, 1]], [3, undefined, [0, 1]]
];
for (const [id, expected, history] of rows) {
  const log: number[] = [];
  const value = locate(values, (entry, index) => { log.push(index); return entry.id === id; });
  same(value, expected);
  assert.compareArray(log, history);
  if (expected === undefined) assert.throws(TypeError, () => Object.prototype.valueOf.call(value));
  else same(Object.prototype.valueOf.call(value), expected);
}
