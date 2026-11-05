/*---
description: "Math.max applied to a dense numeric array returns its largest stored number."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// Math.max applied to a dense numeric array returns its largest stored number. Route: interface field. Node prints reading-math-max-dense:ok.
type T = number;
const items: T[] = [1, 5, 3];
interface Supply { values: T[]; }
const holder: Supply = { values: items }; const target = holder.values;
const result = Math.max(...target);
assert.sameValue(result, 5);
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [true, true, true]);
console.log("reading-math-max-dense:ok");
