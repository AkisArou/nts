/*---
description: "indexOf(undefined) does not match a middle hole and returns -1."
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// indexOf(undefined) does not match a middle hole and returns -1. Route: interface array holder. Node prints visiting-index-of-hole:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
interface Carrier { data: V[]; }
const carrier: Carrier = { data: items }; const target = carrier.data;
const result = target.indexOf(undefined);
assert.sameValue(result, -1);
assert.sameValue(target.indexOf(3), 2);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(i in target);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-index-of-hole:ok");
