/*---
description: Control for conversion-union-bigint-signedness-dispatch; both writes stay in exact local view declarations.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-bigint]
---*/
// Paired case: ../typed-array-contents/conversion-union-bigint-signedness-dispatch.ts; inline both writes, keeping inputs and assertions unchanged.
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
  signed[1] = input;
  unsigned[1] = input;
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
