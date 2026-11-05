/*---
description: "pop on an array containing one hole returns undefined and leaves an empty array. (control)"
features: [ts-hole-routes, ts-hole-route-changing, ts-arrays]
---*/

// pop on an array containing one hole returns undefined and leaves an empty array. Route: discriminated union. Node prints changing-pop-only-hole:ok.
type V = number | undefined;
const items: V[] = [], present: boolean[] = [];
const cells: readonly (readonly [boolean, V])[] = [[false, undefined]];
for (const cell of cells) { items.push(cell[1]); present.push(cell[0]); }
function localPop(values: V[], present: boolean[]): V { const own = present.length > 0 && present[present.length - 1]; const value = values.pop(); present.pop(); return own ? value : undefined; }
type Route = { kind: "yes"; array: V[] } | { kind: "no"; array: V[] };
const r: Route = { kind: "yes", array: items }; const target = r.array;
const result = localPop(target, present);
const current: V[] = [], currentOwn: boolean[] = [];
for (let i = 0; i < target.length; i++) { current.push(present[i] ? target[i] : undefined); currentOwn.push(present[i]); }
assert.compareArray(current, []);
assert.compareArray(currentOwn, []);
assert.sameValue(result, undefined);
console.log("changing-pop-only-hole:ok");
