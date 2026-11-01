/*---
description: Control for parameters-rest-argument-presence; make argument presence explicit.
features: [ts-absent-routes, ts-absent-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-type-aliases, ts-typeof-operator, ts-tuples]
---*/
// An explicit rest count and two required payloads replace collection; a length check handles the second read and recorded keys describe presence.
type AbsentArgumentValue = number | string | boolean | null | undefined | { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type ArgumentSnapshot = { value: AbsentArgumentValue; count: number; present: boolean; own: boolean; keys: string[]; json: string };
function collect(count: number, first: AbsentArgumentValue, second: AbsentArgumentValue): ArgumentSnapshot {
  const one = first === undefined ? "null" : JSON.stringify(first), two = second === undefined ? "null" : JSON.stringify(second);
  return { value: count > 1 ? second : undefined, count, present: count > 1, own: count > 1,
    keys: count === 0 ? [] : count === 1 ? ["0"] : ["0", "1"], json: count === 0 ? "[]" : count === 1 ? "[" + one + "]" : "[" + one + "," + two + "]" };
}
const point = { id: 7 };
const rows: [AbsentArgumentValue, string][] = [[undefined, "null"], [null, "null"], [0, "0"], [-0, "0"],
  ["", '""'], [NaN, "null"], [false, "false"], [point, '{"id":7}']];
for (const [value, element] of rows) for (const count of [0, 1, 2]) {
  const result = collect(count, value, value);
  same(result.value, count === 2 ? value : undefined); same(result.count, count);
  same(result.present, count === 2); same(result.own, count === 2);
  assert.compareArray(result.keys, count === 0 ? [] : count === 1 ? ["0"] : ["0", "1"]);
  same(result.json, count === 0 ? "[]" : count === 1 ? "[" + element + "]" : "[" + element + "," + element + "]");
}
