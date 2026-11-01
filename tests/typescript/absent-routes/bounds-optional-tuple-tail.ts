/*---
description: An optional tuple tail keeps absent elements distinct from stored undefined.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-arrays, ts-tuples, ts-tuple-optional, ts-tuple-labels, ts-destructuring, ts-unions, ts-numbers, ts-strings, ts-objects]
---*/
// An optional tuple crosses a typed reader; node returns undefined for an omitted tail and retains the own slot for explicit undefined.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type BoundsValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 };
const rows: [BoundsValue, string][] = [[undefined, "null"], [null, "null"], [0, "0"], [-0, "0"], ["", '""'], [NaN, "null"], [false, "false"], [marker, '{"id":7}']];
type BoundsTuple = [head: number, tail?: BoundsValue];
function read(tuple: BoundsTuple): BoundsValue[] { const [head, tail] = tuple; same(head, tuple[0]); return [tuple[1], tail]; }
for (const [value, json] of rows) for (const present of [false, true]) {
  const tuple: BoundsTuple = present ? [-0, value] : [-0];
  const expected = present ? value : undefined, keys = Object.keys(tuple);
  for (const actual of read(tuple)) same(actual, expected);
  same(tuple.length, present ? 2 : 1); assert.compareArray(keys, present ? ["0", "1"] : ["0"]);
  same(1 in tuple, present); same(Object.hasOwn(tuple, 1), present);
  same(2 in tuple, false); same(Object.hasOwn(tuple, 2), false);
  same(JSON.stringify(tuple), present ? "[0," + json + "]" : "[0]");
  same(tuple[0], -0);
}
