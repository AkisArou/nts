/*---
description: "Float64 retains finite extrema and minimal subnormals without losing their signs through a static view field."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-static]
---*/

// Float64 retains finite extrema and minimal subnormals without losing their signs; route: a static view field. Node prints floats-f64-extrema-static-field:ok.
type View = DataView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
class FloatSlot { static view: View = new DataView(new ArrayBuffer(10)); }
const rows: readonly [number, number, readonly number[]][] = [
  [Number.MAX_VALUE, 1.7976931348623157e+308, [127, 239, 255, 255, 255, 255, 255, 255]],
  [-Number.MAX_VALUE, -1.7976931348623157e+308, [255, 239, 255, 255, 255, 255, 255, 255]],
  [Number.MIN_VALUE, 5e-324, [0, 0, 0, 0, 0, 0, 0, 1]],
  [-Number.MIN_VALUE, -5e-324, [128, 0, 0, 0, 0, 0, 0, 1]],
];
for (const [value, expected, encoded] of rows) for (const little of [false, true]) {
  FloatSlot.view.setFloat64(1, value, little);
  assert.sameValue(FloatSlot.view.getFloat64(1, little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 8; i++) bytes[1 + i] = encoded[little ? 7 - i : i];
  assert.compareArray(readBytes(FloatSlot.view), bytes);
}
console.log("floats-f64-extrema-static-field:ok");
