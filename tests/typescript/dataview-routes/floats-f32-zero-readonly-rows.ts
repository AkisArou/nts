/*---
description: "Float32 stores positive and negative zero with exact signs in either explicit order and the default order through readonly value and endian tuples."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-unions, ts-null-undefined]
---*/

// Float32 stores positive and negative zero with exact signs in either explicit order and the default order; route: readonly value and endian tuples. Node prints floats-f32-zero-readonly-rows:ok.
type View = DataView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
const plans: readonly [number, boolean | undefined, readonly number[]][] = [
  [0, undefined, [0, 0, 0, 0]], [-0, undefined, [128, 0, 0, 0]],
  [0, false, [0, 0, 0, 0]], [-0, false, [128, 0, 0, 0]],
  [0, true, [0, 0, 0, 0]], [-0, true, [0, 0, 0, 128]],
];
for (const [value, little, expected] of plans) {
  const view: View = new DataView(new ArrayBuffer(4));
  let result: number;
  if (little === undefined) { view.setFloat32(0, value); result = view.getFloat32(0); }
  else { view.setFloat32(0, value, little); result = view.getFloat32(0, little); }
  assert.sameValue(result, value);
  assert.compareArray(readBytes(view), expected);
}
console.log("floats-f32-zero-readonly-rows:ok");
