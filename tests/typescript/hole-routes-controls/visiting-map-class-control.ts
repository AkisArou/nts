/*---
description: "map visits indexes 0 and 2 while preserving the absent middle index in its result. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// map visits indexes 0 and 2 while preserving the absent middle index in its result. Route: private class field. Node prints visiting-map-class:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, 1], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localMap(xs: V[], own: boolean[], visit: (value: V, i: number) => V): { values: V[]; present: boolean[] } { const values: V[] = []; const present: boolean[] = []; for (let i = 0; i < xs.length; i++) { values.push(own[i] ? visit(xs[i], i) : undefined); present.push(own[i]); } return { values, present }; }
class Store { #data: V[]; constructor(xs: V[]) { this.#data = xs; } read(): V[] { return this.#data; } }
const target = new Store(items).read();
const visits: number[] = [];
const result = localMap(target, own, (value, index) => { visits.push(index); return value === undefined ? 0 : value * 10; });
const copy = result.values; const outputPresence = result.present;
const actual: V[] = []; for (let i = 0; i < copy.length; i++) actual.push(outputPresence[i] ? copy[i] : undefined);
assert.compareArray(actual, [10, undefined, 30]); assert.compareArray(outputPresence, [true, false, true]);
assert.compareArray(visits, [0, 2]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-map-class:ok");
