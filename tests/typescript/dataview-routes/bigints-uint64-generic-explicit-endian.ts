/*---
description: "BigUint64 explicit byte orders preserve full unsigned magnitudes and modulo results with exact independent bytes."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-generics, ts-generic-constraints, ts-unions, ts-objects, ts-typeof-operator, ts-narrowing, ts-readonly, ts-tuples, ts-destructuring]
---*/

// BigUint64 explicit byte orders preserve full unsigned magnitudes and modulo results with exact independent bytes. Route: a constrained byte-order helper at boolean and record type arguments. Node prints bigints-uint64-generic-explicit-endian:ok.
type View = DataView;
function check<T extends boolean | { little: boolean }>(input: T, value: bigint, expected: bigint, expectedBytes: readonly number[]): void {
  const little = typeof input === "boolean" ? input : input.little, view: View = new DataView(new ArrayBuffer(8));
  for (let i = 0; i < 8; i++) view.setUint8(i, 165); view.setBigUint64(0, value, little);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(view.getBigUint64(0, little), expected);
}
const rows: readonly [bigint, bigint, readonly number[], readonly number[]][] = [
  [0x123456789abcdefn, 0x123456789abcdefn, [1, 35, 69, 103, 137, 171, 205, 239], [239, 205, 171, 137, 103, 69, 35, 1]],
  [0x89abcdef01234567n, 0x89abcdef01234567n, [137, 171, 205, 239, 1, 35, 69, 103], [103, 69, 35, 1, 239, 205, 171, 137]],
  [-0x2n, 0xfffffffffffffffen, [255, 255, 255, 255, 255, 255, 255, 254], [254, 255, 255, 255, 255, 255, 255, 255]],
  [0x10000000000000000n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]],
  [0x10000000000000001n, 0x1n, [0, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 0]]
];
for (const [value, expected, big, little] of rows) for (const order of [false, true]) {
  check<boolean>(order, value, expected, order ? little : big);
  check<{ little: boolean }>({ little: order }, value, expected, order ? little : big);
}
console.log("bigints-uint64-generic-explicit-endian:ok");
