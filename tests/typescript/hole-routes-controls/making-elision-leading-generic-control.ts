/*---
description: "A leading elision stays absent through a generic array helper. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A leading elision stays absent through a generic array helper. Route: constrained generic. Node prints making-elision-leading-generic:ok.
type V = number | string | undefined;
function localElision(values: V[], present: boolean[], cells: readonly (readonly [boolean, V])[]): void { for (let i = 0; i < cells.length; i++) { values.push(cells[i][1]); present.push(cells[i][0]); } }
const items: V[] = []; const present: boolean[] = [];
localElision(items, present, [[false, undefined], [true, 2], [true, 3]]);
function throughArray<T>(value: T[]): T[] { return value; }
const routed = throughArray<V>(items);
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [undefined, 2, 3]); assert.compareArray(observed, [false, true, true]);
console.log("making-elision-leading-generic:ok");
