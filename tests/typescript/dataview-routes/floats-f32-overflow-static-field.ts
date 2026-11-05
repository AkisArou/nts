/*---
description: "Float32 overflows with the original sign while the largest finite value remains finite through a static view field."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-static]
---*/

// Float32 overflows with the original sign while the largest finite value remains finite; route: a static view field. Node prints floats-f32-overflow-static-field:ok.
type View = DataView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
class FloatSlot { static view: View = new DataView(new ArrayBuffer(6)); }
const rows: readonly [number, number, readonly number[]][] = [
  [1e40, Infinity, [127, 128, 0, 0]],
  [-1e40, -Infinity, [255, 128, 0, 0]],
  [3.4028234663852886e38, 3.4028234663852886e+38, [127, 127, 255, 255]],
  [-3.4028234663852886e38, -3.4028234663852886e+38, [255, 127, 255, 255]],
];
for (const [value, expected, encoded] of rows) for (const little of [false, true]) {
  FloatSlot.view.setFloat32(1, value, little);
  assert.sameValue(FloatSlot.view.getFloat32(1, little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 4; i++) bytes[1 + i] = encoded[little ? 3 - i : i];
  assert.compareArray(readBytes(FloatSlot.view), bytes);
}
console.log("floats-f32-overflow-static-field:ok");
