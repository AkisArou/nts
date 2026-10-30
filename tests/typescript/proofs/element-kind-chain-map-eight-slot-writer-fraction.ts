/*---
description: A delayed writer reaches the front of an alias chain before storing a fraction in a Map.
features: [ts-proof-element-kind, ts-route-chain, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-closures, ts-arrow-functions, ts-function-types]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: eight forward copy rounds deliver the writer; node keeps the fractional value rather than the initial seven.
function read(map: Map<string, number>): unknown { return map.get("item"); }
function after(rounds: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const slots: (() => void)[] = [];
  for (let i = 0; i < 9; i++) slots.push(() => {});
  slots[8] = () => { map.set("item", rounds + 0.25); };
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < 8; i++) slots[i] = slots[i + 1];
  }
  slots[0]();
  return map;
}
for (const n of [0, 1, 7, 8, 10]) {
  assert.sameValue(read(after(n)), n >= 8 ? n + 0.25 : 7);
}
