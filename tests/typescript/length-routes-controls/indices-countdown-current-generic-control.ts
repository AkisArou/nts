/*---
description: Control for indices-countdown-current-generic; local guarded reads preserve the same indices, logs, contents and lengths.
features: [ts-length-route-indices, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-unions]
---*/
// Control: each indexed read follows a fresh local length check with no intervening mutation or call.
const shapes: number[][] = [[], [11], [11, 22, 33], [11, 22, 33, 44]];
const expectedLog: (number | string | undefined)[][] = [[], [0, 11, 1, "shift", 0], [2, 33, 3, "shift", 1, 0, 33, 1, "shift", 0], [3, 44, 4, "shift", 2, 1, 44, 2, "shift", 0]];
const expectedContents: number[][] = [[], [], [], []];
const expectedLengths: number[] = [0, 0, 0, 0];
for (const shape of [0, 1, 2, 3]) {
  const items: number[] = shapes[shape].slice(); const log: (number | string | undefined)[] = [];
  while (true) {
    const length = items.length; if (length === 0) break;
    const index = length - 1; const value: number | undefined = items[index]; log.push(index, value, length);
    items.splice(0, length < 2 ? length : 2); log.push("shift", items.length);
  }
  assert.compareArray(log, expectedLog[shape]); assert.compareArray(items, expectedContents[shape]);
  assert.sameValue(items.length, expectedLengths[shape]);
}
