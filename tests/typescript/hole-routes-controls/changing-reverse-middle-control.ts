/*---
description: "reverse moves the middle hole to its reversed position without filling it. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// reverse moves the middle hole to its reversed position without filling it. Route: interface field. Node prints changing-reverse-middle:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3], [true, 4]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localReverse(values: V[], present: boolean[]): V[] { for (let i = 0; i < values.length / 2; i++) { const j = values.length - 1 - i; const v = values[i], f = present[i]; values[i] = values[j]; present[i] = present[j]; values[j] = v; present[j] = f; } return values; }
interface Carrier { values: V[]; }
const holder: Carrier = { values: items }; const target = holder.values;
const result = localReverse(target, present);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [4, 3, undefined, 1]);
assert.compareArray(currentOwn, [true, true, false, true]);
assert.sameValue(result, target);
console.log("changing-reverse-middle:ok");
