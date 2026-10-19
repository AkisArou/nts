/*---
description: A ReadonlyArray has the non-mutating array methods, which return new arrays.
features: [ts-readonly, ts-arrays]
---*/
const source: ReadonlyArray<number> = [3, 1, 2];
const sorted = [...source].sort((a, b) => a - b);
const doubled = source.map((n) => n * 2);
assert.compareArray(sorted, [1, 2, 3]);
assert.compareArray(doubled, [6, 2, 4]);
assert.compareArray(source, [3, 1, 2]);
assert.sameValue(source.includes(2), true);
assert.sameValue(source.indexOf(1), 1);
const listed: readonly string[] = ["a", "b"];
assert.sameValue(listed.join("+"), "a+b");
