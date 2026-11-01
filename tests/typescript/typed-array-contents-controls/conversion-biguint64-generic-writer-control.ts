/*---
description: Control for conversion-biguint64-generic-writer; the write uses one local BigUint64Array directly.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-bigint, ts-generics, ts-generic-constraints]
---*/
// Paired case: ../typed-array-contents/conversion-biguint64-generic-writer.ts; only the parameter write is inlined into the exact local view.
const rows: [bigint, bigint][] = [
  [0n, 0n], [1n, 1n], [-1n, 18446744073709551615n], [9223372036854775808n, 9223372036854775808n],
  [18446744073709551615n, 18446744073709551615n], [18446744073709551616n, 0n],
  [18446744073709551617n, 1n], [-18446744073709551617n, 18446744073709551615n],
  [1267650600228229401496703205379n, 3n],
];
for (const [input, expected] of rows) {
  const view: BigUint64Array = new BigUint64Array(new ArrayBuffer(48), 16, 3);
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
