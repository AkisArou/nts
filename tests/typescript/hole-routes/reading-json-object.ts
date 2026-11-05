/*---
description: "JSON.stringify serializes a nested array hole as null inside an object's a property."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// JSON.stringify serializes a nested array hole as null inside an object's a property. Route: guarded Map.get lookup. Node prints reading-json-object:ok.
type T = number | undefined | null;
const items: T[] = [, 2];
const store = new Map<string, T[]>(); store.set("x", items);
const found = store.get("x"); if (found === undefined) throw new Error("missing"); const target = found;
const result = JSON.stringify({ a: target });
assert.sameValue(result, '{"a":[null,2]}');
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [false, true]);
console.log("reading-json-object:ok");
