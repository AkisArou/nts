/*---
description: "shift removes a leading hole, returns undefined and leaves both following values present. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// shift removes a leading hole, returns undefined and leaves both following values present. Route: captured closure. Node prints changing-shift-hole:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[false, undefined], [true, 2], [true, 3]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localShift(values: V[], present: boolean[]): V { if (values.length === 0) return undefined; const result = present[0] ? values[0] : undefined; for (let i = 1; i < values.length; i++) { values[i - 1] = values[i]; present[i - 1] = present[i]; } values.pop(); present.pop(); return result; }
let captured: V[] = items; const reader = (): V[] => captured; const target = reader();
const result = localShift(target, present);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [2, 3]);
assert.compareArray(currentOwn, [true, true]);
assert.sameValue(result, undefined);
console.log("changing-shift-hole:ok");
