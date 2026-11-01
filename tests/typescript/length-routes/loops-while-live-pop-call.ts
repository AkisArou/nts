/*---
description: A typed parameter pops during a live-bound while loop so the changing length stops later indexed visits.
features: [ts-length-route-loops, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-null-undefined, ts-expressions, ts-functions]
---*/
// Route: declared number[] carries the changing length through while-index; node records every current index, value and length.
function mutate(values: number[], size: number): void { values.pop(); }
const expectedLog: (number | string | undefined)[][] = [[], [], ["read", 0, 10, 1, "after", 0, 10, 1], ["read", 0, 10, 1, "after", 0, undefined, 0], ["read", 0, 10, 3, "after", 0, 10, 3, "read", 1, 20, 3, "after", 1, 20, 3, "read", 2, 30, 3, "after", 2, 30, 3], ["read", 0, 10, 3, "after", 0, 10, 2, "read", 1, 20, 2, "after", 1, undefined, 1], ["read", 0, 10, 4, "after", 0, 10, 4, "read", 1, 20, 4, "after", 1, 20, 4, "read", 2, 30, 4, "after", 2, 30, 4, "read", 3, 40, 4, "after", 3, 40, 4], ["read", 0, 10, 4, "after", 0, 10, 3, "read", 1, 20, 3, "after", 1, 20, 2]];
const expectedContents: (number | undefined)[][] = [[], [], [10], [], [10, 20, 30], [10], [10, 20, 30, 40], [10, 20]];
let row = 0;
for (const size of [0, 1, 3, 4]) for (const change of [0, 1]) {
  const values: number[] = [10, 20, 30, 40].slice(0, size);
  const log: (number | string | undefined)[] = [];
  let index = 0;
  while (index < values.length) {
    const value: number | undefined = values[index];
    log.push("read", index, value, values.length);
    if (change === 1) { mutate(values, size); }
    const after: number | undefined = values[index];
    log.push("after", index, after, values.length);
    index++;
  }
  assert.compareArray(log, expectedLog[row]);
  assert.compareArray(values, expectedContents[row]); assert.sameValue(values.length, expectedContents[row].length);
  row++;
}
assert.sameValue(row, 8);
