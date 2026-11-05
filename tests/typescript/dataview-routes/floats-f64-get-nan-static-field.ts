/*---
description: "Float64 getters classify distinct signed NaN inputs without asserting an encoding through a reassigned static view field."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-static]
---*/

// Float64 getters classify distinct signed NaN inputs without asserting an encoding; route: a reassigned static view field. Node prints floats-f64-get-nan-static-field:ok.
type View = DataView;
function seeded(input: readonly number[]): View {
  const view: View = new DataView(new ArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) view.setUint8(i, input[i]);
  return view;
}
class FloatSlot {
  static view: View = new DataView(new ArrayBuffer(8));
  static read(little: boolean): number { return FloatSlot.view.getFloat64(0, little); }
}
const patterns: readonly (readonly number[])[] = [
  [127, 248, 0, 0, 0, 0, 0, 0], [127, 240, 0, 0, 0, 0, 0, 1], [255, 248, 0, 0, 0, 0, 0, 7],
];
for (const encoded of patterns) for (const little of [false, true]) {
  const input: number[] = [];
  for (let i = 0; i < 8; i++) input[i] = encoded[little ? 7 - i : i];
  FloatSlot.view = seeded(input);
  assert.sameValue(Number.isNaN(FloatSlot.read(little)), true);
}
console.log("floats-f64-get-nan-static-field:ok");
