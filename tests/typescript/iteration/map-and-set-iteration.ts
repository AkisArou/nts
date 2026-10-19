/*---
description: Maps iterate typed [key, value] entries and Sets their values, both in insertion order.
features: [ts-iteration, ts-map-set]
---*/
const ages = new Map<string, number>([["kim", 30]]);
ages.set("lee", 25).set("kim", 31);
const seen: string[] = [];
for (const [person, age] of ages) seen.push(`${person}${age}`);
assert.compareArray(seen, ["kim31", "lee25"]);
const tags = new Set<string>(["b", "a", "b"]);
tags.add("c");
assert.compareArray([...tags], ["b", "a", "c"]);
assert.compareArray([...ages.keys()], ["kim", "lee"]);
assert.sameValue([...ages.values()].reduce((a, b) => a + b, 0), 56);
