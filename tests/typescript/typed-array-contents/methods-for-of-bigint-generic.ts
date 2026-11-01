/*---
description: For-of through a constrained BigUint64Array generic preserves bigint values beyond safe-number precision.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-generics, ts-generic-constraints]
---*/
// Read with for-of through a generic bigint view; node returns every unsigned 64-bit element without numeric conversion.
function check<V extends BigUint64Array>(view: V, n: bigint): void {
  view.set([n, 0n, 18446744073709551615n]);
  const seen: bigint[] = [];
  for (const value of view) seen.push(value);
  assert.sameValue(seen.length, 3);
  const visited = [n, 0n, 18446744073709551615n];
  for (let i = 0; i < visited.length; i++) assert.sameValue(Object.is(seen[i], visited[i]), true);
  const expected = [n, 0n, 18446744073709551615n];
  assert.sameValue(view.length, 3);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 24);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [0n, 9223372036854775808n, 18446744073709551615n]) check(new BigUint64Array(new ArrayBuffer(40), 8, 3), n);
