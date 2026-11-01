/*---
description: A do-while over a declared number array observes its mandatory empty read and every shrinking length until pop empties it.
features: [ts-length-route-loops, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-null-undefined, ts-expressions]
---*/
// Route: declared number[] carries the changing length through do-zero; node records every current index, value and length.
const expectedLog: (number | string | undefined)[][] = [["read", 0, undefined, 0, "after", 0, undefined, 0], ["read", 0, undefined, 0, "after", 0, undefined, 0], ["read", 0, 10, 1, "after", 0, 10, 1], ["read", 0, 10, 1, "after", 0, undefined, 0], ["read", 0, 10, 3, "after", 0, 10, 3, "read", 0, 10, 3, "after", 0, 10, 3, "read", 0, 10, 3, "after", 0, 10, 3], ["read", 0, 10, 3, "after", 0, 10, 2, "read", 0, 10, 2, "after", 0, 10, 1, "read", 0, 10, 1, "after", 0, undefined, 0], ["read", 0, 10, 4, "after", 0, 10, 4, "read", 0, 10, 4, "after", 0, 10, 4, "read", 0, 10, 4, "after", 0, 10, 4, "read", 0, 10, 4, "after", 0, 10, 4], ["read", 0, 10, 4, "after", 0, 10, 3, "read", 0, 10, 3, "after", 0, 10, 2, "read", 0, 10, 2, "after", 0, 10, 1, "read", 0, 10, 1, "after", 0, undefined, 0]];
const expectedContents: (number | undefined)[][] = [[], [], [10], [], [10, 20, 30], [], [10, 20, 30, 40], []];
let row = 0;
for (const size of [0, 1, 3, 4]) for (const change of [0, 1]) {
  const values: number[] = [10, 20, 30, 40].slice(0, size);
  const log: (number | string | undefined)[] = [];
  let turn = 0;
  do {
    const value: number | undefined = values[0];
    log.push("read", 0, value, values.length);
    if (change === 1) { values.pop(); }
    const after: number | undefined = values[0];
    log.push("after", 0, after, values.length);
    turn++;
  } while (values.length > 0 && turn < Math.max(size, 1));
  assert.compareArray(log, expectedLog[row]);
  assert.compareArray(values, expectedContents[row]); assert.sameValue(values.length, expectedContents[row].length);
  row++;
}
assert.sameValue(row, 8);
