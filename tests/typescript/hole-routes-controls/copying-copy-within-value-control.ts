/*---
description: "copyWithin(2, 0, 2) fills a destination hole when the corresponding source index has a number. (control)"
features: [ts-hole-routes, ts-hole-route-copying, ts-arrays]
---*/

// copyWithin(2, 0, 2) fills a destination hole when the corresponding source index has a number. Route: discriminated union. Node prints copying-copy-within-value:ok.
type V = number | undefined | number[];
const items: V[] = []; const present: boolean[] = [];
const inputCells: readonly (readonly [boolean, V])[] = [[true, 1], [true, 2], [false, undefined], [true, 4]];
for (const cell of inputCells) { items.push(cell[1]); present.push(cell[0]); }
interface Copy { values: V[]; present: boolean[]; }
function localCopyWithin(xs: V[], own: boolean[], to: number, start: number, end: number): Copy { const saved: V[] = [], flags: boolean[] = []; for (let i = start; i < end; i++) { saved.push(own[i] ? xs[i] : undefined); flags.push(own[i]); } for (let i = 0; i < saved.length && to + i < xs.length; i++) { xs[to + i] = saved[i]; own[to + i] = flags[i]; } return { values: xs, present: own }; }
type Route = { tag: "array"; value: V[] } | { tag: "other"; value: V[] };
const entry: Route = { tag: "array", value: items }; const target = entry.value;
const result = localCopyWithin(target, present, 2, 0, 2);
const output = result.values; const own = result.present;
const observedValues: V[] = []; for (let i = 0; i < output.length; i++) observedValues.push(own[i] ? output[i] : undefined);
assert.compareArray(observedValues, [1, 2, 1, 2]); assert.compareArray(own, [true, true, true, true]);
assert.sameValue(output === target, true);
console.log("copying-copy-within-value:ok");
