/*---
description: A typed array with holes reads undefined at them, and iteration methods treat holes differently from undefined.
features: [ts-arrays, ts-null-undefined]
---*/
const sparse: number[] = new Array<number>(3);
sparse[1] = 5;
assert.sameValue(sparse.length, 3);
assert.sameValue(sparse[0], undefined);
assert.sameValue(0 in sparse, false);
let visits = 0;
sparse.forEach(() => visits++);
assert.sameValue(visits, 1);
assert.sameValue([...sparse].filter((v) => v === undefined).length, 2);
assert.sameValue(sparse.map((v) => v * 2)[1], 10);
