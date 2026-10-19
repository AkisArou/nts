/*---
description: A generic arrow function is instantiated per call like a generic declaration.
features: [ts-generics, ts-arrow-functions]
---*/
const pairUp = <T,>(a: T, b: T): T[] => [a, b];
const swap = <A, B>(pair: [A, B]): [B, A] => [pair[1], pair[0]];
assert.sameValue(pairUp(1, 2).length, 2);
assert.sameValue(pairUp("x", "y").join(""), "xy");
const swapped = swap<number, string>([1, "one"]);
assert.sameValue(swapped[0], "one");
assert.sameValue(swapped[1], 1);
