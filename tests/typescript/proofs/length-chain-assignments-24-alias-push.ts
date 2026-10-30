/*---
description: An append through 24 assignments changes the original allocation length.
features: [ts-proof-length, ts-route-chain, ts-functions, ts-iteration, ts-arrays]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: 24 assignment links carry its alias; node reads 5 after a push.
function lengthAfterAliasChain(n: number): number {
  const xs = [10, 20, 30, 40];
  const a1 = xs;
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
  if (n > 0) a24.push(n);
  return xs.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterAliasChain(n), n > 0 ? 5 : 4);
}
