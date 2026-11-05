/*---
description: "A one-comma literal has exactly one hole. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// A one-comma literal has exactly one hole. Route: discriminated union. Node prints making-elision-single-tuple:ok.
type V = number | string | undefined;
function localElision(values: V[], present: boolean[], cells: readonly (readonly [boolean, V])[]): void { for (let i = 0; i < cells.length; i++) { values.push(cells[i][1]); present.push(cells[i][0]); } }
const items: V[] = []; const present: boolean[] = [];
localElision(items, present, [[false, undefined]]);
type Choice = { kind: "array"; items: V[] } | { kind: "other"; items: V[] };
const choice: Choice = { kind: "array", items }; const routed = choice.items;
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 1);
assert.compareArray(actual, [undefined]); assert.compareArray(observed, [false]);
console.log("making-elision-single-tuple:ok");
