/*---
description: Control for loops-for-live-splice-insert; immediate fresh bounds preserve the same indexed observations and final contents.
features: [ts-length-route-loops, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-null-undefined, ts-expressions]
---*/
// Control: one local array and a fresh guard immediately before every indexed read preserve the same visit schedule and mutations.
const expectedLog: (number | string | undefined)[][] = [[], [], ["read", 0, 10, 1, "after", 0, 10, 1], ["read", 0, 10, 1, "after", 0, 10, 2, "read", 1, 70, 2, "after", 1, 70, 2], ["read", 0, 10, 3, "after", 0, 10, 3, "read", 1, 20, 3, "after", 1, 20, 3, "read", 2, 30, 3, "after", 2, 30, 3], ["read", 0, 10, 3, "after", 0, 10, 6, "read", 1, 70, 6, "after", 1, 70, 6, "read", 2, 71, 6, "after", 2, 71, 6, "read", 3, 72, 6, "after", 3, 72, 6, "read", 4, 20, 6, "after", 4, 20, 6, "read", 5, 30, 6, "after", 5, 30, 6], ["read", 0, 10, 4, "after", 0, 10, 4, "read", 1, 20, 4, "after", 1, 20, 4, "read", 2, 30, 4, "after", 2, 30, 4, "read", 3, 40, 4, "after", 3, 40, 4], ["read", 0, 10, 4, "after", 0, 10, 8, "read", 1, 70, 8, "after", 1, 70, 8, "read", 2, 71, 8, "after", 2, 71, 8, "read", 3, 72, 8, "after", 3, 72, 8, "read", 4, 73, 8, "after", 4, 73, 8, "read", 5, 20, 8, "after", 5, 20, 8, "read", 6, 30, 8, "after", 6, 30, 8, "read", 7, 40, 8, "after", 7, 40, 8]];
const expectedContents: (number | undefined)[][] = [[], [], [10], [10, 70], [10, 20, 30], [10, 70, 71, 72, 20, 30], [10, 20, 30, 40], [10, 70, 71, 72, 73, 20, 30, 40]];
let row = 0;
for (const size of [0, 1, 3, 4]) for (const change of [0, 1]) {
  const values: number[] = [10, 20, 30, 40].slice(0, size);
  const log: (number | string | undefined)[] = [];
  let index = 0;
  while (true) {
    const length = values.length; if (index >= length) break;
    const value: number | undefined = values[index];
    log.push("read", index, value, length);
    if (change === 1 && index === 0) { for (let slot = 0; slot < size; slot++) values.splice(1 + slot, 0, 70 + slot); }
    const afterLength = values.length;
    const after: number | undefined = index < afterLength ? values[index] : undefined;
    log.push("after", index, after, afterLength);
    index++;
  }
  assert.compareArray(log, expectedLog[row]);
  assert.compareArray(values, expectedContents[row]); assert.sameValue(values.length, expectedContents[row].length);
  row++;
}
assert.sameValue(row, 8);
