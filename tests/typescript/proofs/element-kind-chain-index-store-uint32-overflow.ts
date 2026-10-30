/*---
description: A value crossing 24 assignments widens the stored element beyond uint32.
features: [ts-proof-element-kind, ts-route-chain, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: 24 value links carry 4294967296 to an index store; the reader keeps it.
function readFirst(xs: number[]): number { return xs[0]; }
function observe(n: number): number {
  const xs = [1];
  let source = 1;
  if (n > 0) source = 4294967296;
  const a1 = source;
  const a2 = a1;
  const a3 = a2;
  const a4 = a3;
  const a5 = a4;
  const a6 = a5;
  const a7 = a6;
  const a8 = a7;
  const a9 = a8;
  const a10 = a9;
  const a11 = a10;
  const a12 = a11;
  const a13 = a12;
  const a14 = a13;
  const a15 = a14;
  const a16 = a15;
  const a17 = a16;
  const a18 = a17;
  const a19 = a18;
  const a20 = a19;
  const a21 = a20;
  const a22 = a21;
  const a23 = a22;
  const a24 = a23;
  xs[0] = a24;
  return readFirst(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? 4294967296 : 1);
}
