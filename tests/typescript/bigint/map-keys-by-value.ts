/*---
description: Bigints compare by value: equal bigints are one Map key and one Set element.
features: [ts-bigint, ts-map-set]
---*/
const names = new Map<bigint, string>();
names.set(10n, "ten");
names.set(5n + 5n, "TEN");
assert.sameValue(names.size, 1);
assert.sameValue(names.get(BigInt("10")), "TEN");
const seen = new Set<bigint>([1n, 1n, 2n]);
assert.sameValue(seen.size, 2);
assert.sameValue(10n === 5n * 2n, true);
