/*---
description: A splice through 16 distinct fields changes the original allocation length.
features: [ts-proof-length, ts-route-chain, ts-functions, ts-iteration, ts-arrays, ts-objects]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: 16 initialized fields carry its alias; node reads 4, 3, or 1.
function lengthAfterFieldChain(n: number): number {
  const xs = [10, 20, 30, 40];
  const l1 = { link1: xs };
  const l2 = { link2: l1 };
  const l3 = { link3: l2 };
  const l4 = { link4: l3 };
  const l5 = { link5: l4 };
  const l6 = { link6: l5 };
  const l7 = { link7: l6 };
  const l8 = { link8: l7 };
  const l9 = { link9: l8 };
  const l10 = { link10: l9 };
  const l11 = { link11: l10 };
  const l12 = { link12: l11 };
  const l13 = { link13: l12 };
  const l14 = { link14: l13 };
  const l15 = { link15: l14 };
  const l16 = { link16: l15 };
  l16.link16.link15.link14.link13.link12.link11.link10.link9.link8.link7.link6.link5.link4.link3.link2.link1.splice(1, n);
  return xs.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterFieldChain(n), n === 0 ? 4 : n === 1 ? 3 : 1);
}
