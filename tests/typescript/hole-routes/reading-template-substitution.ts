/*---
description: "template substitution stringifies a middle hole as an empty field, yielding 1,,3."
features: [ts-hole-routes, ts-hole-route-reading, ts-arrays]
---*/

// template substitution stringifies a middle hole as an empty field, yielding 1,,3. Route: generic helper. Node prints reading-template-substitution:ok.
type T = number | undefined | null;
const items: T[] = [1, , 3];
function view<U>(input: U[]): U[] { return input; }
const target = view<T>(items);
const result = `${target}`;
assert.sameValue(result, "1,,3");
const originalOwn: boolean[] = []; for (let i = 0; i < target.length; i++) originalOwn.push(i in target);
assert.compareArray(originalOwn, [true, false, true]);
console.log("reading-template-substitution:ok");
