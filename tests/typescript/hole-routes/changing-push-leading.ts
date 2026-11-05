/*---
description: "push(5) appends an owned value without filling the leading hole."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// push(5) appends an owned value without filling the leading hole. Route: guarded Map.get lookup. Node prints changing-push-leading:ok.
type V = number | undefined;
const items: V[] = [, 2];
const storage = new Map<string, V[]>(); storage.set("a", items);
const found = storage.get("a"); if (found === undefined) throw new Error("missing"); const target = found;
const result = target.push(5);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [undefined, 2, 5]);
assert.compareArray(currentOwn, [false, true, true]);
assert.sameValue(result, 3);
console.log("changing-push-leading:ok");
