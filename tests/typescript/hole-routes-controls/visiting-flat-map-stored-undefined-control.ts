/*---
description: "flatMap visits stored undefined, skips the adjacent hole, and preserves two undefined results. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// flatMap visits stored undefined, skips the adjacent hole, and preserves two undefined results. Route: generic helper. Node prints visiting-flat-map-stored-undefined:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[true, undefined], [false, undefined], [true, 3]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localFlatMap(xs: V[], own: boolean[], visit: (value: V, i: number) => V[]): { values: V[]; present: boolean[] } { const values: V[] = []; const present: boolean[] = []; for (let i = 0; i < xs.length; i++) if (own[i]) { const pair = visit(xs[i], i); for (let j = 0; j < pair.length; j++) { values.push(pair[j]); present.push(true); } } return { values, present }; }
function take<T>(xs: T[]): T[] { return xs; }
const target = take<V>(items);
const visits: number[] = [];
const result = localFlatMap(target, own, (value, index) => { visits.push(index); return [value, value]; });
const copy = result.values; const outputPresence = result.present;
assert.compareArray(copy, [undefined, undefined, 3, 3]); assert.compareArray(outputPresence, [true, true, true, true]);
assert.compareArray(visits, [0, 2]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [true, false, true]);
console.log("visiting-flat-map-stored-undefined:ok");
