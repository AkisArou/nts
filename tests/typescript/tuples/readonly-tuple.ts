/*---
description: A readonly tuple is not frozen: the array underneath is still mutable through a mutable alias.
features: [ts-tuples, ts-readonly]
---*/
const point: readonly [number, number] = [1, 2];
assert.sameValue(Object.isFrozen(point), false);
const alias = point as unknown as [number, number];
alias[0] = 10;
assert.sameValue(point[0], 10);
assert.sameValue(point.map((n) => n * 2).join(","), "20,4");
