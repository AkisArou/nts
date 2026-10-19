/*---
description: A Record with string keys is a dictionary; reading a missing key gives undefined.
features: [ts-objects, ts-record, ts-index-signatures]
---*/
const counts: Record<string, number> = {};
for (const word of ["a", "b", "a", "c", "a"]) counts[word] = (counts[word] ?? 0) + 1;
assert.sameValue(counts.a, 3);
assert.sameValue(counts["c"], 1);
assert.sameValue(counts["z"], undefined);
assert.sameValue(Object.entries(counts).map(([k, v]) => `${k}${v}`).join(""), "a3b1c1");
