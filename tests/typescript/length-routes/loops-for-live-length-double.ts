/*---
description: Doubling a declared number array length makes a live-bound scan visit new holes as undefined without inventing stored slots.
features: [ts-length-route-loops, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-null-undefined, ts-expressions]
---*/
// Route: declared number[] carries the changing length through live; node records every current index, value and length.
const expectedLog: (number | string | undefined)[][] = [[], [], ["read", 0, 10, 1, "after", 0, 10, 1], ["read", 0, 10, 1, "after", 0, 10, 2, "read", 1, undefined, 2, "after", 1, undefined, 2], ["read", 0, 10, 3, "after", 0, 10, 3, "read", 1, 20, 3, "after", 1, 20, 3, "read", 2, 30, 3, "after", 2, 30, 3], ["read", 0, 10, 3, "after", 0, 10, 6, "read", 1, 20, 6, "after", 1, 20, 6, "read", 2, 30, 6, "after", 2, 30, 6, "read", 3, undefined, 6, "after", 3, undefined, 6, "read", 4, undefined, 6, "after", 4, undefined, 6, "read", 5, undefined, 6, "after", 5, undefined, 6], ["read", 0, 10, 4, "after", 0, 10, 4, "read", 1, 20, 4, "after", 1, 20, 4, "read", 2, 30, 4, "after", 2, 30, 4, "read", 3, 40, 4, "after", 3, 40, 4], ["read", 0, 10, 4, "after", 0, 10, 8, "read", 1, 20, 8, "after", 1, 20, 8, "read", 2, 30, 8, "after", 2, 30, 8, "read", 3, 40, 8, "after", 3, 40, 8, "read", 4, undefined, 8, "after", 4, undefined, 8, "read", 5, undefined, 8, "after", 5, undefined, 8, "read", 6, undefined, 8, "after", 6, undefined, 8, "read", 7, undefined, 8, "after", 7, undefined, 8]];
const expectedContents: (number | undefined)[][] = [[], [], [10], [10, undefined], [10, 20, 30], [10, 20, 30, undefined, undefined, undefined], [10, 20, 30, 40], [10, 20, 30, 40, undefined, undefined, undefined, undefined]];
let row = 0;
for (const size of [0, 1, 3, 4]) for (const change of [0, 1]) {
  const values: number[] = [10, 20, 30, 40].slice(0, size);
  const log: (number | string | undefined)[] = [];
  for (let index = 0; index < values.length; index++) {
    const value: number | undefined = values[index];
    log.push("read", index, value, values.length);
    if (change === 1 && index === 0) { values.length = size * 2; }
    const after: number | undefined = values[index];
    log.push("after", index, after, values.length);
  }
  assert.compareArray(log, expectedLog[row]);
  assert.compareArray(values, expectedContents[row]); assert.sameValue(values.length, expectedContents[row].length);
  for (let slot = 0; slot < values.length; slot++) assert.sameValue(Object.hasOwn(values, slot), slot < size);
  row++;
}
assert.sameValue(row, 8);
