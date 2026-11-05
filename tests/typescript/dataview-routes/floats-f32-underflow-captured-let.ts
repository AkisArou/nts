/*---
description: "Float32 underflow retains the zero sign while minimal subnormals remain nonzero through a captured number binding."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-closures]
---*/

// Float32 underflow retains the zero sign while minimal subnormals remain nonzero; route: a captured number binding. Node prints floats-f32-underflow-captured-let:ok.
type View = DataView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
const view: View = new DataView(new ArrayBuffer(6));
let current: number = 0;
const store = (little: boolean): number => { view.setFloat32(1, current, little); return view.getFloat32(1, little); };
const rows: readonly [number, number, readonly number[]][] = [
  [1e-50, 0, [0, 0, 0, 0]],
  [-1e-50, -0, [128, 0, 0, 0]],
  [1.401298464324817e-45, 1.401298464324817e-45, [0, 0, 0, 1]],
  [-1.401298464324817e-45, -1.401298464324817e-45, [128, 0, 0, 1]],
];
for (const [value, expected, encoded] of rows) for (const little of [false, true]) {
  current = value;
  assert.sameValue(store(little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 4; i++) bytes[1 + i] = encoded[little ? 3 - i : i];
  assert.compareArray(readBytes(view), bytes);
}
console.log("floats-f32-underflow-captured-let:ok");
