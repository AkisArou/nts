/*---
description: "join('-') prints a hole, stored undefined and null as empty fields between numbered endpoints."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// join('-') prints a hole, stored undefined and null as empty fields between numbered endpoints. Route: captured closure. Node prints reading-join-dash:ok.
type T = number | undefined | null;
const items: T[] = [1, , undefined, null, 3];
let pointer: T[] = items; const take = (): T[] => pointer; const target = take();
const result = target.join("-");
assert.sameValue(result, "1----3");
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [true, false, true, true, true]);
console.log("reading-join-dash:ok");
