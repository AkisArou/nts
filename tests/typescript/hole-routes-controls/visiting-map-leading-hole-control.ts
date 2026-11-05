/*---
description: "map retains the leading hole and invokes its callback for a present undefined. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// map retains the leading hole and invokes its callback for a present undefined. Route: guarded Map.get lookup. Node prints visiting-map-leading-hole:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[false, undefined], [true, 2], [true, undefined]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localMap(xs: V[], own: boolean[], visit: (value: V, i: number) => V): { values: V[]; present: boolean[] } { const values: V[] = []; const present: boolean[] = []; for (let i = 0; i < xs.length; i++) { values.push(own[i] ? visit(xs[i], i) : undefined); present.push(own[i]); } return { values, present }; }
const table = new Map<string, V[]>(); table.set("array", items);
const maybe = table.get("array"); if (maybe === undefined) throw new Error("missing"); const target = maybe;
const visits: number[] = [];
const result = localMap(target, own, (value, index) => { visits.push(index); return value === undefined ? 0 : value * 10; });
const copy = result.values; const outputPresence = result.present;
const actual: V[] = []; for (let i = 0; i < copy.length; i++) actual.push(outputPresence[i] ? copy[i] : undefined);
assert.compareArray(actual, [undefined, 20, 0]); assert.compareArray(outputPresence, [false, true, true]);
assert.compareArray(visits, [1, 2]);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [false, true, true]);
console.log("visiting-map-leading-hole:ok");
