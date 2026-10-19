/*---
description: A curried function returns a chain of closures, each capturing the arguments so far.
features: [ts-functions, ts-closures, ts-arrow-functions]
---*/
const add = (a: number) => (b: number) => (c: number): number => a + b + c;
const addOne = add(1);
const addOneTwo = addOne(2);
assert.sameValue(addOneTwo(3), 6);
assert.sameValue(addOne(10)(20), 31);
assert.sameValue(add(0)(0)(0), 0);
