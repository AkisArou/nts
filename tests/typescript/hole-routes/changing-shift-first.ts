/*---
description: "shift removes a present first value and moves the middle hole to the new leading index."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// shift removes a present first value and moves the middle hole to the new leading index. Route: guarded Map.get lookup. Node prints changing-shift-first:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
const storage = new Map<string, V[]>(); storage.set("a", items);
const found = storage.get("a"); if (found === undefined) throw new Error("missing"); const target = found;
const result = target.shift();
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [undefined, 3]);
assert.compareArray(currentOwn, [false, true]);
assert.sameValue(result, 1);
console.log("changing-shift-first:ok");
