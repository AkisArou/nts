/*---
description: Reading a tuple past its last element at run time gives undefined.
features: [ts-tuples, ts-null-undefined]
---*/
const pair: [number, string] = [1, "a"];
const list: number[] = pair.map((value) => String(value).length);
const loose: readonly unknown[] = pair;
assert.sameValue(loose[2], undefined);
assert.sameValue(loose.at(-1), "a");
assert.compareArray(list, [1, 1]);
