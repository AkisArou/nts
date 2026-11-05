/*---
description: "unshift(0) preserves a middle hole while shifting it to index 2."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// unshift(0) preserves a middle hole while shifting it to index 2. Route: discriminated union. Node prints changing-unshift-middle:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
type Route = { kind: "yes"; array: V[] } | { kind: "no"; array: V[] };
const r: Route = { kind: "yes", array: items }; const target = r.array;
const result = target.unshift(0);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [0, 1, undefined, 3]);
assert.compareArray(currentOwn, [true, true, false, true]);
assert.sameValue(result, 4);
console.log("changing-unshift-middle:ok");
