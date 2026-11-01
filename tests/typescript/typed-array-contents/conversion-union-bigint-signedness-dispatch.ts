/*---
description: One union writer receives both signed and unsigned bigint views, preserving different readings of the same 64-bit boundary values and wrapping beyond 64 bits.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-bigint]
---*/
// Both runtime view types enter the same typed writer; node converts each middle slot by its actual element type.
function write(view: BigInt64Array | BigUint64Array, input: bigint): void {
  view[1] = input;
}
const rows: [bigint, bigint, bigint][] = [
  [9223372036854775808n, -9223372036854775808n, 9223372036854775808n],
  [-1n, -1n, 18446744073709551615n],
  [-9223372036854775809n, 9223372036854775807n, 9223372036854775807n],
  [18446744073709551616n, 0n, 0n],
  [18446744073709551617n, 1n, 1n],
  [-18446744073709551617n, -1n, 18446744073709551615n],
];
for (const [input, firstExpected, secondExpected] of rows) {
  const signed: BigInt64Array = new BigInt64Array(new ArrayBuffer(48), 16, 3);
  signed[0] = 17n; signed[2] = 27n;
  const unsigned: BigUint64Array = new BigUint64Array(new ArrayBuffer(48), 16, 3);
  unsigned[0] = 17n; unsigned[2] = 27n;
  write(signed, input);
  write(unsigned, input);
  assert.sameValue(signed.length, 3);
  assert.sameValue(signed.byteOffset, 16);
  assert.sameValue(signed.byteLength, 24);
  assert.sameValue(Object.is(signed[0], 17n), true);
  assert.sameValue(Object.is(signed[1], firstExpected), true);
  assert.sameValue(Object.is(signed[2], 27n), true);
  assert.sameValue(unsigned.length, 3);
  assert.sameValue(unsigned.byteOffset, 16);
  assert.sameValue(unsigned.byteLength, 24);
  assert.sameValue(Object.is(unsigned[0], 17n), true);
  assert.sameValue(Object.is(unsigned[1], secondExpected), true);
  assert.sameValue(Object.is(unsigned[2], 27n), true);
}
