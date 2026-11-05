/*---
description: "Float32 rounds odd integers above two to the twenty fourth with ties to even through a private view field."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-private-fields]
---*/

// Float32 rounds odd integers above two to the twenty fourth with ties to even; route: a private view field. Node prints floats-f32-integer-private-field:ok.
type View = DataView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
class FloatBox {
  #view: View = new DataView(new ArrayBuffer(6));
  store(value: number, little: boolean): number { this.#view.setFloat32(1, value, little); return this.#view.getFloat32(1, little); }
  bytes(): number[] { return readBytes(this.#view); }
}
const rows: readonly [number, number, readonly number[]][] = [
  [16777217, 16777216, [75, 128, 0, 0]],
  [16777219, 16777220, [75, 128, 0, 2]],
  [-16777217, -16777216, [203, 128, 0, 0]],
];
for (const [value, expected, encoded] of rows) for (const little of [false, true]) {
  const box: FloatBox = new FloatBox();
  assert.sameValue(box.store(value, little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 4; i++) bytes[1 + i] = encoded[little ? 3 - i : i];
  assert.compareArray(box.bytes(), bytes);
}
console.log("floats-f32-integer-private-field:ok");
