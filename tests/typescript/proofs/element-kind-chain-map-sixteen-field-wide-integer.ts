/*---
description: A long field chain carries the Map identity to a wide-integer writer.
features: [ts-proof-element-kind, ts-route-chain, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-objects, ts-spread]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the final field alias writes above 32 bits; node reads the same Map through its original name and spread entries.
function read(map: Map<string, number>): unknown { return [...map.entries()][0][1]; }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const a0 = { map }, a1 = { next: a0 }, a2 = { next: a1 }, a3 = { next: a2 };
  const a4 = { next: a3 }, a5 = { next: a4 }, a6 = { next: a5 }, a7 = { next: a6 };
  const a8 = { next: a7 }, a9 = { next: a8 }, a10 = { next: a9 }, a11 = { next: a10 };
  const a12 = { next: a11 }, a13 = { next: a12 }, a14 = { next: a13 }, a15 = { next: a14 };
  const target = a15.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.map;
  if (n > 0) target.set("item", 4294967296 + n);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(read(after(n)), n > 0 ? 4294967296 + n : 7);
}
