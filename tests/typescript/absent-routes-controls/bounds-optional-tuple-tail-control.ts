/*---
description: Control for bounds-optional-tuple-tail; make absence explicit before reading.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-arrays, ts-tuples, ts-interfaces, ts-destructuring, ts-unions, ts-numbers, ts-strings, ts-objects]
---*/
// A required tail payload and explicit presence flag replace the optional slot; recorded keys preserve the same logical observations.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type BoundsValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 };
const rows: [BoundsValue, string][] = [[undefined, "null"], [null, "null"], [0, "0"], [-0, "0"], ["", '""'], [NaN, "null"], [false, "false"], [marker, '{"id":7}']];
interface BoundsTuple { head: number; tail: BoundsValue; present: boolean; }
function read(tuple: BoundsTuple): BoundsValue[] { const head = tuple.head, tail = tuple.present ? tuple.tail : undefined; same(head, tuple.head); return [tail, tail]; }
for (const [value, json] of rows) for (const present of [false, true]) {
  const tuple: BoundsTuple = { head: -0, tail: value, present };
  const expected = present ? value : undefined, keys = present ? ["0", "1"] : ["0"];
  for (const actual of read(tuple)) same(actual, expected);
  same(tuple.present ? 2 : 1, present ? 2 : 1); assert.compareArray(keys, present ? ["0", "1"] : ["0"]);
  same(keys.includes("1"), present); same(keys.includes("1"), present);
  same(keys.includes("2"), false); same(keys.includes("2"), false);
  same(JSON.stringify(tuple.present ? [tuple.head, tuple.tail] : [tuple.head]), present ? "[0," + json + "]" : "[0]");
  same(tuple.head, -0);
}
