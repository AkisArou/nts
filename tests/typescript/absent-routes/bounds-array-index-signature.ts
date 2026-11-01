/*---
description: A numeric index-signature parameter keeps fractional and past-end array reads absent.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-arrays, ts-index-signatures, ts-interfaces, ts-unions, ts-numbers, ts-strings, ts-objects, ts-tuples]
---*/
// Dense union elements cross an index-signature parameter; node returns undefined at negative, fractional, NaN and past-end keys.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type BoundsValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 };
const rows: [BoundsValue, string][] = [[undefined, "null"], [null, "null"], [0, "0"], [-0, "0"], ["", '""'], [NaN, "null"], [false, "false"], [marker, '{"id":7}']];
interface BoundsSlots { [index: number]: BoundsValue; length: number; }
function read(slots: BoundsSlots, index: number): BoundsValue { return slots[index]; }
for (const [value, json] of rows) {
  const source: BoundsValue[] = [value], view: BoundsSlots = source;
  const keys = Object.keys(view);
  assert.compareArray(keys, ["0"]); same(JSON.stringify(source), "[" + json + "]");
  for (const index of [-2, -0, 0, 0.5, 1, 7, NaN]) {
    const present = index === 0, expected = present ? value : undefined;
    same(read(view, index), expected);
    same(index in view, present); same(Object.hasOwn(view, index), present);
  }
  same(view.length, 1);
}
