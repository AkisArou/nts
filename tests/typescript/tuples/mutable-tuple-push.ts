/*---
description: A mutable fixed-length tuple is still an array at run time; push grows it past its type.
features: [ts-tuples]
---*/
const pair: [number, number] = [1, 2];
pair.push(3);
assert.sameValue(pair.length, 3);
assert.sameValue(pair.join(","), "1,2,3");
const extra: number = pair.pop() ?? 0;
assert.sameValue(extra, 3);
assert.sameValue(pair.length, 2);
