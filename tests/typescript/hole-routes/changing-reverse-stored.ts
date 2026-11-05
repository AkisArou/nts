/*---
description: "reverse keeps a stored undefined owned and moves the distinct leading hole to the end."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// reverse keeps a stored undefined owned and moves the distinct leading hole to the end. Route: guarded Map.get lookup. Node prints changing-reverse-stored:ok.
type V = number | undefined;
const items: V[] = [, undefined, 3];
const storage = new Map<string, V[]>(); storage.set("a", items);
const found = storage.get("a"); if (found === undefined) throw new Error("missing"); const target = found;
const result = target.reverse();
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [3, undefined, undefined]);
assert.compareArray(currentOwn, [true, true, false]);
assert.sameValue(result, target);
console.log("changing-reverse-stored:ok");
