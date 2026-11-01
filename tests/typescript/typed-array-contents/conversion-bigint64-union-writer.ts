/*---
description: Signed 64-bit bigint wrapping at both limits and beyond 64 bits through a union writer.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-bigint]
---*/
// Write through a union parameter; read the exact local view; node converts the middle slot and preserves its guards.
function write(view: BigInt64Array | BigUint64Array, input: bigint): void {
  view[1] = input;
}
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
  write(view, input);
  assert.sameValue(view.length, 3);
  assert.sameValue(view.byteOffset, 16);
  assert.sameValue(view.byteLength, 24);
  assert.sameValue(Object.is(view[0], 17n), true);
  assert.sameValue(Object.is(view[1], expected), true);
  assert.sameValue(Object.is(view[2], 27n), true);
}
