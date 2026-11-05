/*---
description: "pop removes a present final number while preserving the preceding hole."
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// pop removes a present final number while preserving the preceding hole. Route: readonly tuple row. Node prints changing-pop-tail-value:ok.
type V = number | undefined;
const items: V[] = [1, , 3];
const rows: readonly [string, V[]][] = [["a", items]];
const target = rows[0][1];
const result = target.pop();
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(target[i]); currentOwn.push(i in target); }
assert.compareArray(current, [1, undefined]);
assert.compareArray(currentOwn, [true, false]);
assert.sameValue(result, 3);
console.log("changing-pop-tail-value:ok");
