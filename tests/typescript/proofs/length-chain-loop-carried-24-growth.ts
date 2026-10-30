/*---
description: Only an alias that traverses all 24 loop-carried slots grows the original array.
features: [ts-proof-length, ts-route-chain, ts-functions, ts-iteration, ts-arrays]
---*/
// Fact: xs has length 4 (docs/foundations/objects.md, Arrays).
// Route: reverse updates delay its alias for 24 turns; node reads 4, then 5.
function lengthAfterDelayedAlias(turns: number): number {
  const xs = [10, 20, 30, 40];
  const other = [99];
  let a1 = other, a2 = other, a3 = other;
  let a4 = other, a5 = other, a6 = other;
  let a7 = other, a8 = other, a9 = other;
  let a10 = other, a11 = other, a12 = other;
  let a13 = other, a14 = other, a15 = other;
  let a16 = other, a17 = other, a18 = other;
  let a19 = other, a20 = other, a21 = other;
  let a22 = other, a23 = other, a24 = other;
  for (let turn = 0; turn < turns; turn++) {
    a24 = a23; a23 = a22; a22 = a21;
    a21 = a20; a20 = a19; a19 = a18;
    a18 = a17; a17 = a16; a16 = a15;
    a15 = a14; a14 = a13; a13 = a12;
    a12 = a11; a11 = a10; a10 = a9;
    a9 = a8; a8 = a7; a7 = a6;
    a6 = a5; a5 = a4; a4 = a3;
    a3 = a2; a2 = a1; a1 = xs;
  }
  a24.push(50);
  return xs.length;
}
for (const n of [0, 1, 23, 24, 25, 31]) {
  assert.sameValue(lengthAfterDelayedAlias(n), n < 24 ? 4 : 5);
}
