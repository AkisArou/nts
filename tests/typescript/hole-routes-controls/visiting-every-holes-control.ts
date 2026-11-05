/*---
description: "every on an array containing only holes returns true without invoking its callback. (control)"
features: [ts-hole-routes, ts-hole-route-visiting, ts-arrays]
---*/

// every on an array containing only holes returns true without invoking its callback. Route: guarded Map.get lookup. Node prints visiting-every-holes:ok.
type V = number | undefined;
const items: V[] = []; const own: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[false, undefined], [false, undefined]];
for (const cell of cells) { items.push(cell[1]); own.push(cell[0]); }
function localEvery(xs: V[], own: boolean[], visit: (value: V, i: number) => boolean): boolean { for (let i = 0; i < xs.length; i++) if (own[i] && !visit(xs[i], i)) return false; return true; }
const table = new Map<string, V[]>(); table.set("array", items);
const maybe = table.get("array"); if (maybe === undefined) throw new Error("missing"); const target = maybe;
const visits: number[] = [];
const result = localEvery(target, own, (value, index) => { visits.push(index); return true; });
assert.sameValue(result, true); assert.compareArray(visits, []);
const presence: boolean[] = []; for (let i = 0; i < target.length; i++) presence.push(own[i]);
assert.compareArray(presence, [false, false]);
console.log("visiting-every-holes:ok");
