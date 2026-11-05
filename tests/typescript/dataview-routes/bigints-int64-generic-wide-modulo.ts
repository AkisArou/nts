/*---
description: "BigInt64 discards distant high limbs while preserving every low bit and the resulting signed value."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-generics, ts-generic-constraints, ts-unions, ts-objects, ts-typeof-operator, ts-narrowing, ts-readonly, ts-tuples, ts-destructuring]
---*/

// BigInt64 discards distant high limbs while preserving every low bit and the resulting signed value. Route: a constrained helper at bigint and bigint-record type arguments. Node prints bigints-int64-generic-wide-modulo:ok.
type View = DataView;
function check<T extends bigint | { value: bigint }>(input: T, expected: bigint, expectedBytes: readonly number[]): void {
  const value = typeof input === "bigint" ? input : input.value, view: View = new DataView(new ArrayBuffer(8));
  for (let i = 0; i < 8; i++) view.setUint8(i, 165); view.setBigInt64(0, value, false);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(view.getBigInt64(0, false), expected);
}
const rows: readonly [bigint, bigint, readonly number[]][] = [
  [0x400000000000000000123456789abcdefn, 0x123456789abcdefn, [1, 35, 69, 103, 137, 171, 205, 239]],
  [-0x400000000000000000123456789abcdefn, -0x123456789abcdefn, [254, 220, 186, 152, 118, 84, 50, 17]],
  [0x400000000000000008000000000000001n, -0x7fffffffffffffffn, [128, 0, 0, 0, 0, 0, 0, 1]],
  [-0x400000000000000000000000000000000n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0]],
  [-0x400000000000000000000000000000001n, -0x1n, [255, 255, 255, 255, 255, 255, 255, 255]]
];
for (const [value, expected, bytes] of rows) { check<bigint>(value, expected, bytes); check<{ value: bigint }>({ value }, expected, bytes); }
console.log("bigints-int64-generic-wide-modulo:ok");
