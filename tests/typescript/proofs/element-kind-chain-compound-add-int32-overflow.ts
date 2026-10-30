/*---
description: A delayed loop-carried addend widens an array element past int32.
features: [ts-proof-element-kind, ts-route-chain, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: 24 reverse updates deliver 1 to +=; the separate read is 2147483648.
function readFirst(xs: number[]): number { return xs[0]; }
function observe(turns: number): number {
  const xs = [2147483647];
  let a1 = 0, a2 = 0, a3 = 0;
  let a4 = 0, a5 = 0, a6 = 0;
  let a7 = 0, a8 = 0, a9 = 0;
  let a10 = 0, a11 = 0, a12 = 0;
  let a13 = 0, a14 = 0, a15 = 0;
  let a16 = 0, a17 = 0, a18 = 0;
  let a19 = 0, a20 = 0, a21 = 0;
  let a22 = 0, a23 = 0, a24 = 0;
  for (let turn = 0; turn < turns; turn++) {
    a24 = a23; a23 = a22; a22 = a21;
    a21 = a20; a20 = a19; a19 = a18;
    a18 = a17; a17 = a16; a16 = a15;
    a15 = a14; a14 = a13; a13 = a12;
    a12 = a11; a11 = a10; a10 = a9;
    a9 = a8; a8 = a7; a7 = a6;
    a6 = a5; a5 = a4; a4 = a3;
    a3 = a2; a2 = a1; a1 = 1;
  }
  xs[0] += a24;
  return readFirst(xs);
}
for (const n of [0, 1, 23, 24, 25, 31]) {
  assert.sameValue(observe(n), n < 24 ? 2147483647 : 2147483648);
}
