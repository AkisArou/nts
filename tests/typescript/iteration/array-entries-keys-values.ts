/*---
description: An array's entries, keys and values iterators yield typed tuples, indexes and elements.
features: [ts-iteration, ts-arrays, ts-tuples]
---*/
const letters = ["a", "b", "c"];
const pairs: string[] = [];
for (const [index, letter] of letters.entries()) pairs.push(`${index}${letter}`);
assert.compareArray(pairs, ["0a", "1b", "2c"]);
assert.compareArray([...letters.keys()], [0, 1, 2]);
assert.compareArray([...letters.values()], letters);
