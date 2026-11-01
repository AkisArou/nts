/*---
description: Control for callbacks-map-snapshot-holes; a local traversal takes fresh guarded reads and preserves the same source, callback observations and results.
features: [ts-length-route-callbacks, ts-arrays, ts-iteration, ts-numbers, ts-null-undefined, ts-objects]
---*/
// Control: explicit local traversal checks the current length immediately before each read; original visit limits and observations stay the same.
const expectedLog: (string | number | undefined)[][] = [[], [], [], ["read", 0, 2, 1, "tail", 0, 2, 1], ["read", 0, 2, 1, "tail", 0, undefined, 0], ["read", 0, 2, 1, "tail", 0, 2, 2], ["read", 0, 2, 3, "tail", 2, 90, 3, "read", 1, 4, 3, "tail", 2, 90, 3, "read", 2, 90, 3, "tail", 2, 90, 3], ["read", 0, 2, 3, "tail", 2, undefined, 0], ["read", 0, 2, 3, "tail", 2, 6, 6, "read", 1, 4, 6, "tail", 5, 102, 6, "read", 2, 6, 6, "tail", 5, 102, 6], ["read", 0, 2, 4, "tail", 3, 90, 4, "read", 1, 4, 4, "tail", 3, 90, 4, "read", 2, 6, 4, "tail", 3, 90, 4, "read", 3, 90, 4, "tail", 3, 90, 4], ["read", 0, 2, 4, "tail", 3, undefined, 0], ["read", 0, 2, 4, "tail", 3, 8, 8, "read", 1, 4, 8, "tail", 7, 103, 8, "read", 2, 6, 8, "tail", 7, 103, 8, "read", 3, 8, 8, "tail", 7, 103, 8]];
const expectedFinal: number[][] = [[], [], [], [2], [], [2, 100], [2, 4, 90], [], [2, 4, 6, 100, 101, 102], [2, 4, 6, 90], [], [2, 4, 6, 8, 100, 101, 102, 103]];
const expectedResult: (number | undefined)[][] = [[], [], [], [4], [4], [4], [4, 8, 180], [4, undefined, undefined], [4, 8, 12], [4, 8, 12, 180], [4, undefined, undefined, undefined], [4, 8, 12, 16]];
const expectedPresent: boolean[][] = [[], [], [], [true], [true], [true], [true, true, true], [true, false, false], [true, true, true], [true, true, true, true], [true, false, false, false], [true, true, true, true]];
let scenario = 0;
for (const size of [0, 1, 3, 4]) for (const mode of [0, 1, 2]) {
  const values: number[] = size === 0 ? [] : size === 1 ? [2] : size === 3 ? [2, 4, 6] : [2, 4, 6, 8];
  const log: (string | number | undefined)[] = [];
  const result: number[] = new Array<number>(size);
  for (let index = 0; index < size; index++) {
    if (index >= values.length) continue;
    const value: number = values[index];
    log.push("read", index, value, values.length);
    const oldLast = values.length - 1;
    if (index === 0) {
      if (mode === 0 && values.length > 1) values[values.length - 1] = 90;
      else if (mode === 1) values.length = 0;
      else if (mode === 2) for (let added = 0; added < size; added++) values.push(100 + added);
    }
    const tail: number | undefined = oldLast >= 0 && oldLast < values.length ? values[oldLast] : undefined;
    log.push("tail", oldLast, tail, values.length);
    result[index] = value * 2;
  }
  assert.compareArray(log, expectedLog[scenario]);
  assert.compareArray(values, expectedFinal[scenario]); assert.sameValue(values.length, expectedFinal[scenario].length);
  assert.compareArray(result, expectedResult[scenario]); assert.sameValue(result.length, expectedResult[scenario].length);
  for (let index = 0; index < result.length; index++) assert.sameValue(Object.hasOwn(result, index), expectedPresent[scenario][index]);
  scenario++;
}
assert.sameValue(scenario, 12);
