/*---
description: "Float32 getters distinguish minimal subnormals and the subnormal to normal boundary from literal bytes through a private view field."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-private-fields]
---*/

// Float32 getters distinguish minimal subnormals and the subnormal to normal boundary from literal bytes; route: a private view field. Node prints floats-f32-get-subnormal-private-field:ok.
type View = DataView;
function seeded(input: readonly number[]): View {
  const view: View = new DataView(new ArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) view.setUint8(i, input[i]);
  return view;
}
class FloatBox {
  #view: View;
  constructor(input: readonly number[]) { this.#view = seeded(input); }
  read(little: boolean): number { return this.#view.getFloat32(0, little); }
}
const rows: readonly [number, readonly number[]][] = [
  [1.401298464324817e-45, [0, 0, 0, 1]],
  [-1.401298464324817e-45, [128, 0, 0, 1]],
  [1.1754942106924411e-38, [0, 127, 255, 255]],
  [1.1754943508222875e-38, [0, 128, 0, 0]],
];
for (const [expected, encoded] of rows) for (const little of [false, true]) {
  const input: number[] = [];
  for (let i = 0; i < 4; i++) input[i] = encoded[little ? 3 - i : i];
  const box: FloatBox = new FloatBox(input);
  assert.sameValue(box.read(little), expected);
}
console.log("floats-f32-get-subnormal-private-field:ok");
