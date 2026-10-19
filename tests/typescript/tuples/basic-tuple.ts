/*---
description: A tuple holds a different type at each position and is an ordinary array.
features: [ts-tuples]
---*/
const entry: [string, number, boolean] = ["age", 42, true];
assert.sameValue(entry[0].toUpperCase(), "AGE");
assert.sameValue(entry[1] + 1, 43);
assert.sameValue(entry[2], true);
assert.sameValue(entry.length, 3);
assert.sameValue(Array.isArray(entry), true);
