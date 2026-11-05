/*---
description: "Truncation destroys values so later regrowth yields holes. (control)"
features: [ts-hole-routes, ts-hole-route-making, ts-arrays]
---*/

// Truncation destroys values so later regrowth yields holes. Route: Map.get. Node prints making-length-truncate-regrow-map:ok.
type V = number | string | undefined;
function localElision(values: V[], present: boolean[], cells: readonly (readonly [boolean, V])[]): void { for (let i = 0; i < cells.length; i++) { values.push(cells[i][1]); present.push(cells[i][0]); } }
function localLength(values: V[], present: boolean[], size: number): void { if (size < 0 || size % 1 !== 0 || size > 1000) throw new RangeError(); while (values.length > size) { values.pop(); present.pop(); } while (values.length < size) { values.push(undefined); present.push(false); } }
const items: V[] = []; const present: boolean[] = [];
localElision(items, present, [[true, 1], [true, 2], [true, 3]]);
const bank = new Map<string, V[]>(); bank.set("entry", items);
const found = bank.get("entry"); if (found === undefined) throw new Error("missing"); const routed = found;
localLength(routed, present, 1); localLength(routed, present, 3);
const actual: V[] = []; const observed: boolean[] = [];
for (let i = 0; i < routed.length; i++) { actual.push(present[i] ? routed[i] : undefined); observed.push(present[i]); }
assert.sameValue(routed.length, 3);
assert.compareArray(actual, [1, undefined, undefined]); assert.compareArray(observed, [true, false, false]);
console.log("making-length-truncate-regrow-map:ok");
