/*---
description: "Setting length to zero clears all former indexes before growth. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Setting length to zero clears all former indexes before growth. Route: captured closure. Node prints making-length-zero-then-regrow:ok.
type V = number | string | undefined;
function localElision(values: V[], present: boolean[], cells: readonly (readonly [boolean, V])[]): void { for (let i = 0; i < cells.length; i++) { values.push(cells[i][1]); present.push(cells[i][0]); } }
function localLength(values: V[], present: boolean[], size: number): void { if (size < 0 || size % 1 !== 0 || size > 1000) throw new RangeError(); while (values.length > size) { values.pop(); present.pop(); } while (values.length < size) { values.push(undefined); present.push(false); } }
const items: V[] = []; const present: boolean[] = [];
localElision(items, present, [[true, 1], [false, undefined], [true, 3]]);
let captured: V[] = items; const readCaptured = (): V[] => captured;
const routed = readCaptured();
localLength(routed, present, 0); localLength(routed, present, 2);
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 2);
assert.compareArray(actual, [undefined, undefined]); assert.compareArray(observed, [false, false]);
console.log("making-length-zero-then-regrow:ok");
