/*---
description: Control for conversion-bigint64-union-writer; the write uses one local BigInt64Array directly.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-bigint]
---*/
// Paired case: ../typed-array-contents/conversion-bigint64-union-writer.ts; only the parameter write is inlined into the exact local view.
const rows: [bigint, bigint][] = [
  [0n, 0n], [1n, 1n], [-1n, -1n], [9223372036854775807n, 9223372036854775807n],
  [9223372036854775808n, -9223372036854775808n], [-9223372036854775808n, -9223372036854775808n],
  [-9223372036854775809n, 9223372036854775807n], [18446744073709551615n, -1n],
  [18446744073709551616n, 0n], [18446744073709551617n, 1n], [-18446744073709551617n, -1n],
  [1267650600228229401496703205379n, 3n],
];
for (const [input, expected] of rows) {
  const view: BigInt64Array = new BigInt64Array(new ArrayBuffer(48), 16, 3);
  view[0] = 17n;
  view[2] = 27n;
  view[1] = input;
  assert.sameValue(view.length, 3);
  assert.sameValue(view.byteOffset, 16);
  assert.sameValue(view.byteLength, 24);
  assert.sameValue(Object.is(view[0], 17n), true);
  assert.sameValue(Object.is(view[1], expected), true);
  assert.sameValue(Object.is(view[2], 27n), true);
}
