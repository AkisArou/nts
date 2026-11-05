/*---
description: "Array.toString prints the missing middle element as an empty field."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// Array.toString prints the missing middle element as an empty field. Route: discriminated union. Node prints reading-to-string-sparse:ok.
type T = number | undefined | null;
const items: T[] = [1, , 3];
type Choice = { kind: "a"; array: T[] } | { kind: "b"; array: T[] };
const selection: Choice = { kind: "a", array: items }; const target = selection.array;
const result = target.toString();
assert.sameValue(result, "1,,3");
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-to-string-sparse:ok");
