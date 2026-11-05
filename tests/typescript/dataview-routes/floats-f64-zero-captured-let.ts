/*---
description: "Float64 keeps both zero signs with omitted or explicit byte order through a captured number binding."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-closures, ts-unions, ts-null-undefined]
---*/

// Float64 keeps both zero signs with omitted or explicit byte order; route: a captured number binding. Node prints floats-f64-zero-captured-let:ok.
type View = DataView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
const view: View = new DataView(new ArrayBuffer(10));
let current: number = 1;
const store = (little: boolean | undefined): number => {
  if (little === undefined) { view.setFloat64(1, current); return view.getFloat64(1); }
  view.setFloat64(1, current, little); return view.getFloat64(1, little);
};
const rows: readonly [number, number, readonly number[]][] = [
  [0, 0, [0, 0, 0, 0, 0, 0, 0, 0]],
  [-0, -0, [128, 0, 0, 0, 0, 0, 0, 0]],
];
for (const [value, expected, encoded] of rows) for (const little of [undefined, false, true]) {
  current = value;
  assert.sameValue(store(little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 8; i++) bytes[1 + i] = encoded[little ? 7 - i : i];
  assert.compareArray(readBytes(view), bytes);
}
console.log("floats-f64-zero-captured-let:ok");
