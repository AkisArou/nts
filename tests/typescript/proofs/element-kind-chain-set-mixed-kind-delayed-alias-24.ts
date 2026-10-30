/*---
description: A string insertion crosses twenty-four Set aliases before changing the original collection kind.
features: [ts-proof-element-kind, ts-route-chain, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-strings, ts-spread, ts-typeof-operator]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the new string is added through a delayed alias that reaches the original only on trip 24.
function read(items: Set<number | string>): number | string {
  const values = [...items];
  return values[values.length - 1];
}
function observe(depth: number): number | string {
  const items = new Set<number | string>([1, 2]);
  const other = new Set<number | string>([7, 8]);
  let s0 = other, s1 = other, s2 = other, s3 = other, s4 = other, s5 = other;
  let s6 = other, s7 = other, s8 = other, s9 = other, s10 = other, s11 = other;
  let s12 = other, s13 = other, s14 = other, s15 = other, s16 = other, s17 = other;
  let s18 = other, s19 = other, s20 = other, s21 = other, s22 = other, s23 = other;
  for (let i = 0; i < depth; i++) {
    s23 = s22; s22 = s21; s21 = s20; s20 = s19; s19 = s18; s18 = s17;
    s17 = s16; s16 = s15; s15 = s14; s14 = s13; s13 = s12; s12 = s11;
    s11 = s10; s10 = s9; s9 = s8; s8 = s7; s7 = s6; s6 = s5;
    s5 = s4; s4 = s3; s3 = s2; s2 = s1; s1 = s0; s0 = items;
  }
  s23.add("item:" + depth);
  return read(items);
}
for (const n of [0, 1, 23, 24, 25, 32]) {
  const result = observe(n);
  assert.sameValue(typeof result, n >= 24 ? "string" : "number");
  assert.sameValue(result, n >= 24 ? "item:" + n : 2);
}
