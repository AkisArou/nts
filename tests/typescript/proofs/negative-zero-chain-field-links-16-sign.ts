/*---
description: Negative zero propagates through sixteen distinct initialized numeric fields.
features: [ts-proof-negative-zero, ts-route-chain, ts-functions, ts-iteration, ts-numbers, ts-objects]
---*/
// Fact: each distinct field initially holds positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: sixteen dependent field stores carry the changed sign; node reads -0 at the end.
function throughFields(n: number): number {
  const fields = { f0: 0, f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, f8: 0, f9: 0, f10: 0, f11: 0, f12: 0, f13: 0, f14: 0, f15: 0, f16: 0 };
  if (n > 0) fields.f0 = -0;
  fields.f1 = fields.f0;
  fields.f2 = fields.f1;
  fields.f3 = fields.f2;
  fields.f4 = fields.f3;
  fields.f5 = fields.f4;
  fields.f6 = fields.f5;
  fields.f7 = fields.f6;
  fields.f8 = fields.f7;
  fields.f9 = fields.f8;
  fields.f10 = fields.f9;
  fields.f11 = fields.f10;
  fields.f12 = fields.f11;
  fields.f13 = fields.f12;
  fields.f14 = fields.f13;
  fields.f15 = fields.f14;
  fields.f16 = fields.f15;
  return fields.f16;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(throughFields(n), n > 0 ? -0 : 0);
}
