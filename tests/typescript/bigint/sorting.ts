/*---
description: An array of bigints sorts numerically with a comparator and as strings without one.
features: [ts-bigint, ts-arrays]
---*/
const values: bigint[] = [10n, 9n, 100n, -1n];
const numeric = [...values].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
const lexical = [...values].sort();
assert.compareArray(numeric, [-1n, 9n, 10n, 100n]);
assert.compareArray(lexical, [-1n, 10n, 100n, 9n]);
