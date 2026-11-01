/*---
description: Control for loops-do-while-pop; immediate fresh bounds preserve the same indexed observations and final contents.
features: [ts-length-route-loops, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-null-undefined, ts-expressions]
---*/
// Control: one local array and a fresh guard immediately before every indexed read preserve the same visit schedule and mutations.
const expectedLog: (number | string | undefined)[][] = [["read", 0, undefined, 0, "after", 0, undefined, 0], ["read", 0, undefined, 0, "after", 0, undefined, 0], ["read", 0, 10, 1, "after", 0, 10, 1], ["read", 0, 10, 1, "after", 0, undefined, 0], ["read", 0, 10, 3, "after", 0, 10, 3, "read", 0, 10, 3, "after", 0, 10, 3, "read", 0, 10, 3, "after", 0, 10, 3], ["read", 0, 10, 3, "after", 0, 10, 2, "read", 0, 10, 2, "after", 0, 10, 1, "read", 0, 10, 1, "after", 0, undefined, 0], ["read", 0, 10, 4, "after", 0, 10, 4, "read", 0, 10, 4, "after", 0, 10, 4, "read", 0, 10, 4, "after", 0, 10, 4, "read", 0, 10, 4, "after", 0, 10, 4], ["read", 0, 10, 4, "after", 0, 10, 3, "read", 0, 10, 3, "after", 0, 10, 2, "read", 0, 10, 2, "after", 0, 10, 1, "read", 0, 10, 1, "after", 0, undefined, 0]];
const expectedContents: (number | undefined)[][] = [[], [], [10], [], [10, 20, 30], [], [10, 20, 30, 40], []];
let row = 0;
for (const size of [0, 1, 3, 4]) for (const change of [0, 1]) {
  const values: number[] = [10, 20, 30, 40].slice(0, size);
  const log: (number | string | undefined)[] = [];
  let turn = 0;
  do {
    const length = values.length;
    const value: number | undefined = length > 0 ? values[0] : undefined;
    log.push("read", 0, value, length);
    if (change === 1) { values.pop(); }
    const afterLength = values.length;
    const after: number | undefined = 0 < afterLength ? values[0] : undefined;
    log.push("after", 0, after, afterLength);
    turn++;
  } while (values.length > 0 && turn < Math.max(size, 1));
  assert.compareArray(log, expectedLog[row]);
  assert.compareArray(values, expectedContents[row]); assert.sameValue(values.length, expectedContents[row].length);
  row++;
}
assert.sameValue(row, 8);
