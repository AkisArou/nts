/*---
description: A typed reducer changes its own source length while accumulating only the live slots below the original bound.
features: [ts-length-route-callbacks, ts-arrays, ts-iteration, ts-numbers, ts-null-undefined, ts-arrow-functions, ts-functions]
---*/
// Route: number[] callback ownership mutates the source during traversal; node keeps the original visit bound and observes current slots and lengths.
const expectedLog: (string | number | undefined)[][] = [[], [], [], ["read", 0, 2, 1, "tail", 0, 2, 1], ["read", 0, 2, 1, "tail", 0, undefined, 0], ["read", 0, 2, 1, "tail", 0, 2, 2], ["read", 0, 2, 3, "tail", 2, 90, 3, "read", 1, 4, 3, "tail", 2, 90, 3, "read", 2, 90, 3, "tail", 2, 90, 3], ["read", 0, 2, 3, "tail", 2, undefined, 0], ["read", 0, 2, 3, "tail", 2, 6, 6, "read", 1, 4, 6, "tail", 5, 102, 6, "read", 2, 6, 6, "tail", 5, 102, 6], ["read", 0, 2, 4, "tail", 3, 90, 4, "read", 1, 4, 4, "tail", 3, 90, 4, "read", 2, 6, 4, "tail", 3, 90, 4, "read", 3, 90, 4, "tail", 3, 90, 4], ["read", 0, 2, 4, "tail", 3, undefined, 0], ["read", 0, 2, 4, "tail", 3, 8, 8, "read", 1, 4, 8, "tail", 7, 103, 8, "read", 2, 6, 8, "tail", 7, 103, 8, "read", 3, 8, 8, "tail", 7, 103, 8]];
const expectedFinal: number[][] = [[], [], [], [2], [], [2, 100], [2, 4, 90], [], [2, 4, 6, 100, 101, 102], [2, 4, 6, 90], [], [2, 4, 6, 8, 100, 101, 102, 103]];
const expectedResult: (number | undefined)[] = [0, 0, 0, 2, 2, 2, 96, 2, 12, 102, 2, 20];
let scenario = 0;
for (const size of [0, 1, 3, 4]) for (const mode of [0, 1, 2]) {
  const values: number[] = size === 0 ? [] : size === 1 ? [2] : size === 3 ? [2, 4, 6] : [2, 4, 6, 8];
  const log: (string | number | undefined)[] = [];
  const result = values.reduce((sum: number, value: number, index: number, owner: number[]) => {
    log.push("read", index, value, owner.length);
    const oldLast = owner.length - 1;
    if (index === 0) {
      if (mode === 0 && owner.length > 1) owner[owner.length - 1] = 90;
      else if (mode === 1) owner.length = 0;
      else if (mode === 2) for (let added = 0; added < size; added++) owner.push(100 + added);
    }
    const tail: number | undefined = owner[oldLast];
    log.push("tail", oldLast, tail, owner.length);
    return sum + value;
  }, 0);
  assert.compareArray(log, expectedLog[scenario]);
  assert.compareArray(values, expectedFinal[scenario]); assert.sameValue(values.length, expectedFinal[scenario].length);
  assert.sameValue(result, expectedResult[scenario]); assert.sameValue(typeof result, typeof expectedResult[scenario]);
  scenario++;
}
assert.sameValue(scenario, 12);
