/*---
description: "shift returns a stored undefined and moves the next hole to the front."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// shift returns a stored undefined and moves the next hole to the front. Route: readonly tuple row. Node prints changing-shift-stored:ok.
type V = number | undefined;
const items: V[] = [undefined, , 3];
const rows: readonly [string, V[]][] = [["a", items]];
const target = rows[0][1];
const result = target.shift();
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [undefined, 3]);
assert.compareArray(currentOwn, [false, true]);
assert.sameValue(result, undefined);
console.log("changing-shift-stored:ok");
