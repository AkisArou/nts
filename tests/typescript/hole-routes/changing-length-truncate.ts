/*---
description: "truncating length to two discards the last number and leaves the retained middle hole."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// truncating length to two discards the last number and leaves the retained middle hole. Route: guarded Map.get lookup. Node prints changing-length-truncate:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
const storage = new Map<string, V[]>(); storage.set("a", items);
const found = storage.get("a"); if (found === undefined) throw new Error("missing"); const target = found;
target.length = 2;
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [1, undefined]);
assert.compareArray(currentOwn, [true, false]);
console.log("changing-length-truncate:ok");
