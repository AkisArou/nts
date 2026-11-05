/*---
description: "Int32 explicit byte orders keep signed values after wrapping and produce exact asymmetric bytes in either branch."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-unions, ts-narrowing, ts-objects, ts-strings, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Int32 explicit byte orders keep signed values after wrapping and produce exact asymmetric bytes in either branch. Route: a discriminated union with distinct View fields. Node prints integers-int32-union-endian:ok.
type View = DataView;
type OrderView = { kind: "big"; big: View } | { kind: "little"; little: View };
function check(job: OrderView, value: number, expected: number, expectedBytes: readonly number[]): void {
  const view = job.kind === "big" ? job.big : job.little;
  if (job.kind === "big") view.setInt32(0, value, false); else view.setInt32(0, value, true);
  const result = job.kind === "big" ? view.getInt32(0, false) : view.getInt32(0, true);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = view.getUint8(i);
  assert.sameValue(result, expected); assert.compareArray(bytes, expectedBytes);
}
const rows: readonly [number, number, readonly number[], readonly number[]][] = [
  [305419896, 305419896, [18, 52, 86, 120], [120, 86, 52, 18]],
  [-2147483647, -2147483647, [128, 0, 0, 1], [1, 0, 0, 128]],
  [2147483648, -2147483648, [128, 0, 0, 0], [0, 0, 0, 128]], [4294967297, 1, [0, 0, 0, 1], [1, 0, 0, 0]]
];
for (const [value, expected, big, little] of rows) for (const order of [false, true]) {
  const view: View = new DataView(new ArrayBuffer(4));
  check(order ? { kind: "little", little: view } : { kind: "big", big: view }, value, expected, order ? little : big);
}
console.log("integers-int32-union-endian:ok");
