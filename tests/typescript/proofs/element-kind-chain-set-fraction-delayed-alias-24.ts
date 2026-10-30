/*---
description: A fractional Set writer reaches the original collection only after twenty-four loop-carried alias steps.
features: [ts-proof-element-kind, ts-route-chain, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: twenty-four distinct aliases update in reverse order, advancing the original Set by one slot per trip.
function read(items: Set<number>): number {
  let last = 0;
  for (const value of items) last = value;
  return last;
}
function observe(depth: number): number {
  const items = new Set<number>([1, 2]);
  const other = new Set<number>([7, 8]);
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
  s23.add(depth + 0.5);
  return read(items);
}
for (const n of [0, 1, 23, 24, 25, 32]) {
  const result = observe(n);
  assert.sameValue(result, n >= 24 ? n + 0.5 : 2);
}
