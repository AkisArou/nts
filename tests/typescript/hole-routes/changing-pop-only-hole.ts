/*---
description: "pop on an array containing one hole returns undefined and leaves an empty array."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// pop on an array containing one hole returns undefined and leaves an empty array. Route: discriminated union. Node prints changing-pop-only-hole:ok.
type V = number | undefined;
const items: V[] = [,];
type Route = { kind: "yes"; array: V[] } | { kind: "no"; array: V[] };
const r: Route = { kind: "yes", array: items }; const target = r.array;
const result = target.pop();
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, []);
assert.compareArray(currentOwn, []);
assert.sameValue(result, undefined);
console.log("changing-pop-only-hole:ok");
