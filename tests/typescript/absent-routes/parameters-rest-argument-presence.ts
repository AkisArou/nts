/*---
description: A typed rest parameter retains supplied undefined elements and reads undefined when its second element is missing.
features: [ts-absent-routes, ts-absent-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-type-aliases, ts-typeof-operator, ts-rest-parameters, ts-tuples, ts-expressions]
---*/
// A typed rest array has no second slot after zero or one argument; node distinguishes that from a second argument explicitly holding undefined.
type AbsentArgumentValue = number | string | boolean | null | undefined | { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type ArgumentSnapshot = { value: AbsentArgumentValue; count: number; present: boolean; own: boolean; keys: string[]; json: string };
function collect(...items: AbsentArgumentValue[]): ArgumentSnapshot {
  return { value: items[1], count: items.length, present: 1 in items, own: Object.hasOwn(items, 1),
    keys: Object.keys(items), json: JSON.stringify(items) };
}
const point = { id: 7 };
const rows: [AbsentArgumentValue, string][] = [[undefined, "null"], [null, "null"], [0, "0"], [-0, "0"],
  ["", '""'], [NaN, "null"], [false, "false"], [point, '{"id":7}']];
for (const [value, element] of rows) for (const count of [0, 1, 2]) {
  const result = count === 0 ? collect() : count === 1 ? collect(value) : collect(value, value);
  same(result.value, count === 2 ? value : undefined); same(result.count, count);
  same(result.present, count === 2); same(result.own, count === 2);
  assert.compareArray(result.keys, count === 0 ? [] : count === 1 ? ["0"] : ["0", "1"]);
  same(result.json, count === 0 ? "[]" : count === 1 ? "[" + element + "]" : "[" + element + "," + element + "]");
}
