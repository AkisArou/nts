/*---
description: Control for bounds-array-index-signature; make absence explicit before reading.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-arrays, ts-index-signatures, ts-interfaces, ts-unions, ts-numbers, ts-strings, ts-objects, ts-tuples]
---*/
// Keep the dense input; explicit integer and length checks return undefined without an invalid read, and recorded keys report presence.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type BoundsValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 };
const rows: [BoundsValue, string][] = [[undefined, "null"], [null, "null"], [0, "0"], [-0, "0"], ["", '""'], [NaN, "null"], [false, "false"], [marker, '{"id":7}']];
interface BoundsSlots { [index: number]: BoundsValue; length: number; }
function read(slots: BoundsSlots, index: number): BoundsValue { return Number.isInteger(index) && index >= 0 && index < slots.length ? slots[index] : undefined; }
for (const [value, json] of rows) {
  const source: BoundsValue[] = [value], view: BoundsSlots = source;
  const keys = ["0"];
  assert.compareArray(keys, ["0"]); same(JSON.stringify(source), "[" + json + "]");
  for (const index of [-2, -0, 0, 0.5, 1, 7, NaN]) {
    const present = index === 0, expected = present ? value : undefined;
    same(read(view, index), expected);
    same(keys.includes(String(index)), present); same(keys.includes(String(index)), present);
  }
  same(view.length, 1);
}
