/*---
description: Keys of a tuple type are its index strings at run time; a numeric key reads the element.
features: [ts-type-operators, ts-keyof, ts-tuples, ts-indexed-access]
---*/
const point: [number, number, number] = [3, 4, 5];
type Index = Exclude<keyof typeof point, keyof number[]>;
const indexes = Object.keys(point) as Index[];
assert.sameValue(indexes.join(","), "0,1,2");
let product = 1;
for (const index of indexes) product *= point[index];
assert.sameValue(product, 60);
