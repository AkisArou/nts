/*---
description: Assigning zero to a number array length inside a cached-bound for loop preserves the scheduled undefined reads.
features: [ts-length-route-loops, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-null-undefined, ts-expressions]
---*/
// Route: declared number[] carries the changing length through cached; node records every current index, value and length.
const expectedLog: (number | string | undefined)[][] = [[], [], ["read", 0, 10, 1, "after", 0, 10, 1], ["read", 0, 10, 1, "after", 0, undefined, 0], ["read", 0, 10, 3, "after", 0, 10, 3, "read", 1, 20, 3, "after", 1, 20, 3, "read", 2, 30, 3, "after", 2, 30, 3], ["read", 0, 10, 3, "after", 0, undefined, 0, "read", 1, undefined, 0, "after", 1, undefined, 0, "read", 2, undefined, 0, "after", 2, undefined, 0], ["read", 0, 10, 4, "after", 0, 10, 4, "read", 1, 20, 4, "after", 1, 20, 4, "read", 2, 30, 4, "after", 2, 30, 4, "read", 3, 40, 4, "after", 3, 40, 4], ["read", 0, 10, 4, "after", 0, undefined, 0, "read", 1, undefined, 0, "after", 1, undefined, 0, "read", 2, undefined, 0, "after", 2, undefined, 0, "read", 3, undefined, 0, "after", 3, undefined, 0]];
const expectedContents: (number | undefined)[][] = [[], [], [10], [], [10, 20, 30], [], [10, 20, 30, 40], []];
let row = 0;
for (const size of [0, 1, 3, 4]) for (const change of [0, 1]) {
  const values: number[] = [10, 20, 30, 40].slice(0, size);
  const log: (number | string | undefined)[] = [];
  for (let index = 0, limit = values.length; index < limit; index++) {
    const value: number | undefined = values[index];
    log.push("read", index, value, values.length);
    if (change === 1 && index === 0) { values.length = 0; }
    const after: number | undefined = values[index];
    log.push("after", index, after, values.length);
  }
  assert.compareArray(log, expectedLog[row]);
  assert.compareArray(values, expectedContents[row]); assert.sameValue(values.length, expectedContents[row].length);
  row++;
}
assert.sameValue(row, 8);
