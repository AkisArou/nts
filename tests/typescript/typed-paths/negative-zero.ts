/*---
description: A typed number keeps -0 through storage and arithmetic, distinguishable by division and Object.is.
features: [ts-numbers]
---*/
const values: number[] = [0, -0];
const product: number = -1 * 0;
const record = { zero: -0 };
assert.sameValue(values[1], -0);
assert.sameValue(1 / product, -Infinity);
assert.sameValue(Object.is(record.zero, -0), true);
assert.sameValue(record.zero === 0, true);
assert.sameValue(Math.round(-0.4), -0);
assert.sameValue(-0 + 0, 0);
