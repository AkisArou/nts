/*---
description: "Float32 rounds decimal fractions to exact binary32 values and bytes through a public view field."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields]
---*/

// Float32 rounds decimal fractions to exact binary32 values and bytes; route: a public view field. Node prints floats-f32-decimal-public-field:ok.
type View = DataView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
class FloatBox { view: View = new DataView(new ArrayBuffer(6)); }
const rows: readonly [number, number, readonly number[]][] = [
  [0.1, 0.10000000149011612, [61, 204, 204, 205]],
  [-0.1, -0.10000000149011612, [189, 204, 204, 205]],
  [1 / 3, 0.3333333432674408, [62, 170, 170, 171]],
];
for (const [value, expected, encoded] of rows) for (const little of [false, true]) {
  const box: FloatBox = new FloatBox();
  box.view.setFloat32(1, value, little);
  assert.sameValue(box.view.getFloat32(1, little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 4; i++) bytes[1 + i] = encoded[little ? 3 - i : i];
  assert.compareArray(readBytes(box.view), bytes);
}
console.log("floats-f32-decimal-public-field:ok");
