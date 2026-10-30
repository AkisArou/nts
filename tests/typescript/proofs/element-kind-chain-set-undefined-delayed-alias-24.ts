/*---
description: A present undefined entry reaches the original Set through twenty-four delayed aliases.
features: [ts-proof-element-kind, ts-route-chain, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-null-undefined]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: one alias slot advances per back edge; s23 writes the original only after twenty-four trips.
function check(items: Set<number | undefined>, changed: boolean): void {
  const iterator = items.values();
  const first = iterator.next(), second = iterator.next(), third = iterator.next();
  assert.sameValue(first.done, false);
  assert.sameValue(first.value, 1);
  assert.sameValue(second.done, false);
  assert.sameValue(second.value, 2);
  assert.sameValue(third.done, !changed);
  assert.sameValue(third.value, undefined);
  const end = iterator.next();
  assert.sameValue(end.done, true);
  assert.sameValue(end.value, undefined);
  assert.sameValue(items.has(undefined), changed);
  assert.sameValue(items.size, changed ? 3 : 2);
}
function observe(depth: number): Set<number | undefined> {
  const items = new Set<number | undefined>([1, 2]);
  const other = new Set<number | undefined>([7, 8]);
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
  s23.add(undefined);
  return items;
}
for (const n of [0, 1, 23, 24, 25, 32]) check(observe(n), n >= 24);
