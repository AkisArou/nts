/*---
description: "Assigning fractional length throws and preserves holes. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Assigning fractional length throws and preserves holes. Route: interface field. Node prints making-length-invalid-fraction:ok.
type V = number | string | undefined;
function localElision(values: V[], present: boolean[], cells: readonly (readonly [boolean, V])[]): void { for (let i = 0; i < cells.length; i++) { values.push(cells[i][1]); present.push(cells[i][0]); } }
function localLength(values: V[], present: boolean[], size: number): void { if (size < 0 || size % 1 !== 0 || size > 1000) throw new RangeError(); while (values.length > size) { values.pop(); present.pop(); } while (values.length < size) { values.push(undefined); present.push(false); } }
const items: V[] = []; const present: boolean[] = [];
localElision(items, present, [[true, 1], [false, undefined], [true, 3]]);
interface HoleCarrier { items: V[]; }
const carrier: HoleCarrier = { items }; const routed = carrier.items;
assert.throws(RangeError, () => localLength(routed, present, 1.5));
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [1, undefined, 3]); assert.compareArray(observed, [true, false, true]);
console.log("making-length-invalid-fraction:ok");
