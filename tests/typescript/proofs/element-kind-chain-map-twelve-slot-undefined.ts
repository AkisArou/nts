/*---
description: A delayed writer stores an explicit undefined entry only after traversing twelve aliases.
features: [ts-proof-element-kind, ts-route-chain, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-function-types, ts-closures, ts-arrow-functions, ts-destructuring, ts-null-undefined]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: twelve copy rounds deliver the undefined writer; node distinguishes the new entry from an absent key.
function read(map: Map<string, number>): unknown { return map.get("added"); }
function after(rounds: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const writable: Map<string, unknown> = map;
  const slots: (() => void)[] = [];
  for (let i = 0; i < 13; i++) slots.push(() => {});
  slots[12] = () => { writable.set("added", undefined); };
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < 12; i++) slots[i] = slots[i + 1];
  }
  slots[0]();
  return map;
}
for (const n of [0, 1, 11, 12, 15]) {
  const map = after(n);
  assert.sameValue(read(map), undefined);
  assert.sameValue(map.has("added"), n >= 12);
  assert.sameValue(map.size, n >= 12 ? 2 : 1);
  assert.sameValue(map.get("item"), 7);
  let visits = 0;
  for (const [key, value] of map) if (key === "added") {
    visits++;
    assert.sameValue<unknown>(value, undefined);
  }
  assert.sameValue(visits, n >= 12 ? 1 : 0);
}
