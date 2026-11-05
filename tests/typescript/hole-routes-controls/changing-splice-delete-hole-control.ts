/*---
description: "splice(0, 1) returns a single removed hole as a hole and shifts the other slots. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// splice(0, 1) returns a single removed hole as a hole and shifts the other slots. Route: interface field. Node prints changing-splice-delete-hole:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[false, undefined], [true, 2], [false, undefined], [true, 4]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localSplice(values: V[], present: boolean[], index: number, count: number, insert?: V): { values: V[]; present: boolean[] } { const removed: V[] = [], removedOwn: boolean[] = [], next: V[] = [], nextOwn: boolean[] = []; for (let i = 0; i < index; i++) { next.push(values[i]); nextOwn.push(present[i]); } for (let i = index; i < index + count && i < values.length; i++) { removed.push(present[i] ? values[i] : undefined); removedOwn.push(present[i]); } if (insert !== undefined) { next.push(insert); nextOwn.push(true); } for (let i = index + count; i < values.length; i++) { next.push(values[i]); nextOwn.push(present[i]); } while (values.length > 0) { values.pop(); present.pop(); } for (let i = 0; i < next.length; i++) { values.push(next[i]); present.push(nextOwn[i]); } return { values: removed, present: removedOwn }; }
interface Carrier { values: V[]; }
const holder: Carrier = { values: items }; const target = holder.values;
const result = localSplice(target, present, 0, 1);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, [2, undefined, 4]);
assert.compareArray(currentOwn, [true, false, true]);
const removed = result.values;
const removedOwn: boolean[] = []; for (let i = 0; i < removed.length; i++) removedOwn.push(result.present[i]);
const removedValues: V[] = []; for (let i = 0; i < removed.length; i++) removedValues.push(removedOwn[i] ? removed[i] : undefined);
assert.compareArray(removedValues, [undefined]); assert.compareArray(removedOwn, [false]);
console.log("changing-splice-delete-hole:ok");
