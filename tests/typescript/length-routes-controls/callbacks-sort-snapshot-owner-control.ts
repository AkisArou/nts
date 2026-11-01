/*---
description: Control for callbacks-sort-snapshot-owner; a local traversal takes fresh guarded reads and preserves the same source, callback observations and results.
features: [ts-length-route-callbacks, ts-arrays, ts-iteration, ts-numbers, ts-null-undefined]
---*/
// Control: an immutable ascending copy reproduces node's adjacent comparisons, while local guarded reads observe the same source mutations.
const expectedLog: (string | number | undefined)[][] = [[], [], [], [], [], [], ["compare", 1, 4, 0, 2, 3, "tail", 2, 90, 3, "compare", 2, 6, 1, 4, 3, "tail", 2, 90, 3], ["compare", 1, 4, 0, 2, 3, "tail", 2, undefined, 0, "compare", 2, 6, 1, 4, 0, "tail", -1, undefined, 0], ["compare", 1, 4, 0, 2, 3, "tail", 2, 6, 6, "compare", 2, 6, 1, 4, 6, "tail", 5, 102, 6], ["compare", 1, 4, 0, 2, 4, "tail", 3, 90, 4, "compare", 2, 6, 1, 4, 4, "tail", 3, 90, 4, "compare", 3, 8, 2, 6, 4, "tail", 3, 90, 4], ["compare", 1, 4, 0, 2, 4, "tail", 3, undefined, 0, "compare", 2, 6, 1, 4, 0, "tail", -1, undefined, 0, "compare", 3, 8, 2, 6, 0, "tail", -1, undefined, 0], ["compare", 1, 4, 0, 2, 4, "tail", 3, 8, 8, "compare", 2, 6, 1, 4, 8, "tail", 7, 103, 8, "compare", 3, 8, 2, 6, 8, "tail", 7, 103, 8]];
const expectedFinal: number[][] = [[], [], [], [2], [2], [2], [2, 4, 6], [2, 4, 6], [2, 4, 6, 100, 101, 102], [2, 4, 6, 8], [2, 4, 6, 8], [2, 4, 6, 8, 100, 101, 102, 103]];
const expectedResult: number[][] = [[], [], [], [2], [2], [2], [2, 4, 6], [2, 4, 6], [2, 4, 6, 100, 101, 102], [2, 4, 6, 8], [2, 4, 6, 8], [2, 4, 6, 8, 100, 101, 102, 103]];
let scenario = 0;
for (const size of [0, 1, 3, 4]) for (const mode of [0, 1, 2]) {
  const values: number[] = size === 0 ? [] : size === 1 ? [2] : size === 3 ? [2, 4, 6] : [2, 4, 6, 8];
  const log: (string | number | undefined)[] = [];
  const snapshot: number[] = values.slice(); let step = 0;
  for (let index = 1; index < snapshot.length; index++) {
    const a = snapshot[index], b = snapshot[index - 1];
    log.push("compare", a / 2 - 1, a, b / 2 - 1, b, values.length);
    const oldLast = values.length - 1;
    if (step === 0) {
      if (mode === 0 && values.length > 1) values[values.length - 1] = 90;
      else if (mode === 1) values.length = 0;
      else if (mode === 2) for (let added = 0; added < size; added++) values.push(100 + added);
    }
    const tail: number | undefined = oldLast >= 0 && oldLast < values.length ? values[oldLast] : undefined;
    log.push("tail", oldLast, tail, values.length); step++;
  }
  for (let index = 0; index < snapshot.length; index++) values[index] = snapshot[index];
  const result = values;
  assert.compareArray(log, expectedLog[scenario]);
  assert.compareArray(values, expectedFinal[scenario]); assert.sameValue(values.length, expectedFinal[scenario].length);
  assert.compareArray(result, expectedResult[scenario]); assert.sameValue(result.length, expectedResult[scenario].length);
  assert.sameValue(result, values);
  scenario++;
}
assert.sameValue(scenario, 12);
