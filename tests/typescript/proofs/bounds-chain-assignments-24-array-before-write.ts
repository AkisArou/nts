/*---
description: A pop through 24 aliases makes old index 3 append and restore length 4.
features: [ts-proof-bounds, ts-route-chain, ts-functions, ts-iteration, ts-arrays]
---*/
// docs/foundations/objects.md, Arrays: index 3 is safe before the alias chain can remove its slot.
// A pop through 24 aliases makes old index 3 append and restore length 4.
function write(change: number): number {
  const xs = [11, 22, 33, 44];
  const index = 3;
  const a0 = xs;
  const a1 = a0;
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
  if (change > 0) a24.pop();
  xs[index] = 70 + change;
  return xs.length * 100 + xs[index];
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(write(change), 470 + change);
