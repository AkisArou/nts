/*---
description: "Float64 infinity signs have exact bytes in omitted and explicit byte orders through readonly value and endian tuples."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-unions, ts-null-undefined]
---*/

// Float64 infinity signs have exact bytes in omitted and explicit byte orders; route: readonly value and endian tuples. Node prints floats-f64-infinities-readonly-tuples:ok.
type View = DataView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
const rows: readonly [number, number, readonly number[]][] = [
  [Infinity, Infinity, [127, 240, 0, 0, 0, 0, 0, 0]],
  [-Infinity, -Infinity, [255, 240, 0, 0, 0, 0, 0, 0]],
];
for (const [value, expected, encoded] of rows) for (const little of [undefined, false, true]) {
  const plan: readonly [number, boolean | undefined] = [value, little];
  const [selected, order] = plan;
  const view: View = new DataView(new ArrayBuffer(10));
  let result: number;
  if (order === undefined) { view.setFloat64(1, selected); result = view.getFloat64(1); }
  else { view.setFloat64(1, selected, order); result = view.getFloat64(1, order); }
  assert.sameValue(result, expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 8; i++) bytes[1 + i] = encoded[little ? 7 - i : i];
  assert.compareArray(readBytes(view), bytes);
}
console.log("floats-f64-infinities-readonly-tuples:ok");
