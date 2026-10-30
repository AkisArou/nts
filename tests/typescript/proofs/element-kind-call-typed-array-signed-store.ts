/*---
description: Small ordinary array elements do not make a called Int32Array writer unsigned.
features: [ts-proof-element-kind, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: ordinary arrays hold small integers (docs/foundations/objects.md, Arrays).
// Route: a called typed writer stores a negative int32; node gives -3470 at n=3.
function smallWholeNumbers(n: number): number {
  const xs = [1, 2];
  return xs[n & 1];
}
function writeSigned(xs: Int32Array, n: number): void {
  xs[0] = n * 1000000007;
}
function readRemainder(xs: Int32Array): number { return xs[0] % 4093; }
function observe(n: number): number {
  const xs = new Int32Array(1);
  writeSigned(xs, n);
  return readRemainder(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  const expected = n === 0 ? 0 : n === 1 ? 2340 : n === 3 ? -3470 : n === 4 ? -1130 : -507;
  assert.sameValue(smallWholeNumbers(n), (n & 1) === 0 ? 1 : 2);
  assert.sameValue(observe(n), expected);
}
