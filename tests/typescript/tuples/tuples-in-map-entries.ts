/*---
description: Map entries are [key, value] tuples, built from and spread back into arrays of tuples.
features: [ts-tuples, ts-map-set]
---*/
const pairs: [string, number][] = [["a", 1], ["b", 2]];
const map = new Map(pairs);
map.set("c", 3);
const entries: [string, number][] = [...map.entries()];
assert.sameValue(entries.length, 3);
assert.sameValue(entries[2][0] + entries[2][1], "c3");
let sum = 0;
for (const [, value] of map) sum += value;
assert.sameValue(sum, 6);
assert.sameValue(Object.fromEntries(entries).b, 2);
