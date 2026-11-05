/*---
description: "Float64 getters preserve zero and infinity signs from literal bytes with default or explicit order through a private view field."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-private-fields, ts-unions, ts-null-undefined]
---*/

// Float64 getters preserve zero and infinity signs from literal bytes with default or explicit order; route: a private view field. Node prints floats-f64-get-specials-private-field:ok.
type View = DataView;
function seeded(input: readonly number[]): View {
  const view: View = new DataView(new ArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) view.setUint8(i, input[i]);
  return view;
}
class FloatBox {
  #view: View;
  constructor(input: readonly number[]) { this.#view = seeded(input); }
  read(little: boolean | undefined): number { return little === undefined ? this.#view.getFloat64(0) : this.#view.getFloat64(0, little); }
}
const rows: readonly [number, readonly number[]][] = [
  [0, [0, 0, 0, 0, 0, 0, 0, 0]],
  [-0, [128, 0, 0, 0, 0, 0, 0, 0]],
  [Infinity, [127, 240, 0, 0, 0, 0, 0, 0]],
  [-Infinity, [255, 240, 0, 0, 0, 0, 0, 0]],
];
for (const [expected, encoded] of rows) for (const little of [undefined, false, true]) {
  const input: number[] = [];
  for (let i = 0; i < 8; i++) input[i] = encoded[little ? 7 - i : i];
  const box: FloatBox = new FloatBox(input);
  assert.sameValue(box.read(little), expected);
}
console.log("floats-f64-get-specials-private-field:ok");
