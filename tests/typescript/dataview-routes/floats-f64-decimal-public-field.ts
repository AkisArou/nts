/*---
description: "Float64 retains the original binary64 decimal values with all eight exact bytes through a public view field."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields]
---*/

// Float64 retains the original binary64 decimal values with all eight exact bytes; route: a public view field. Node prints floats-f64-decimal-public-field:ok.
type View = DataView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
class FloatBox { view: View = new DataView(new ArrayBuffer(10)); }
const rows: readonly [number, number, readonly number[]][] = [
  [0.1, 0.1, [63, 185, 153, 153, 153, 153, 153, 154]],
  [-0.1, -0.1, [191, 185, 153, 153, 153, 153, 153, 154]],
  [-0.3, -0.3, [191, 211, 51, 51, 51, 51, 51, 51]],
];
for (const [value, expected, encoded] of rows) for (const little of [false, true]) {
  const box: FloatBox = new FloatBox();
  box.view.setFloat64(1, value, little);
  assert.sameValue(box.view.getFloat64(1, little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 8; i++) bytes[1 + i] = encoded[little ? 7 - i : i];
  assert.compareArray(readBytes(box.view), bytes);
}
console.log("floats-f64-decimal-public-field:ok");
