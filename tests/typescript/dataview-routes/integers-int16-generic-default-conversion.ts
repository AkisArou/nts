/*---
description: "setInt16 uses big endian by default after truncation and modulo conversion, including signed limits and nonfinite zeroes."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-generics, ts-generic-constraints, ts-unions, ts-objects, ts-typeof-operator, ts-narrowing, ts-readonly, ts-tuples, ts-destructuring]
---*/

// setInt16 uses big endian by default after truncation and modulo conversion, including signed limits and nonfinite zeroes. Route: a constrained helper at number and record type arguments. Node prints integers-int16-generic-default-conversion:ok.
type View = DataView;
function check<T extends number | { value: number }>(input: T, expected: number, expectedBytes: readonly number[]): void {
  const value = typeof input === "number" ? input : input.value, view: View = new DataView(new ArrayBuffer(2));
  for (let i = 0; i < 2; i++) view.setUint8(i, 165);
  view.setInt16(0, value);
  const bytes: number[] = []; for (let i = 0; i < 2; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(view.getInt16(0), expected);
}
const rows: readonly [number, number, readonly number[]][] = [
  [-32769, 32767, [127, 255]], [-32768, -32768, [128, 0]], [32767, 32767, [127, 255]],
  [32768, -32768, [128, 0]], [65535, -1, [255, 255]], [65536, 0, [0, 0]], [65537, 1, [0, 1]],
  [-1.9, -1, [255, 255]], [-0.9, 0, [0, 0]], [NaN, 0, [0, 0]], [Infinity, 0, [0, 0]], [-Infinity, 0, [0, 0]]
];
for (const [value, expected, bytes] of rows) { check<number>(value, expected, bytes); check<{ value: number }>({ value }, expected, bytes); }
console.log("integers-int16-generic-default-conversion:ok");
