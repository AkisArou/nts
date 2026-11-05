/*---
description: "Float64 preserves integers that binary32 cannot retain including the largest safe integer through a private view field."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-private-fields]
---*/

// Float64 preserves integers that binary32 cannot retain including the largest safe integer; route: a private view field. Node prints floats-f64-integer-private-field:ok.
type View = DataView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
class FloatBox {
  #view: View = new DataView(new ArrayBuffer(10));
  store(value: number, little: boolean): number { this.#view.setFloat64(1, value, little); return this.#view.getFloat64(1, little); }
  bytes(): number[] { return readBytes(this.#view); }
}
const rows: readonly [number, number, readonly number[]][] = [
  [16777217, 16777217, [65, 112, 0, 0, 16, 0, 0, 0]],
  [-16777217, -16777217, [193, 112, 0, 0, 16, 0, 0, 0]],
  [9007199254740991, 9007199254740991, [67, 63, 255, 255, 255, 255, 255, 255]],
];
for (const [value, expected, encoded] of rows) for (const little of [false, true]) {
  const box: FloatBox = new FloatBox();
  assert.sameValue(box.store(value, little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 8; i++) bytes[1 + i] = encoded[little ? 7 - i : i];
  assert.compareArray(box.bytes(), bytes);
}
console.log("floats-f64-integer-private-field:ok");
