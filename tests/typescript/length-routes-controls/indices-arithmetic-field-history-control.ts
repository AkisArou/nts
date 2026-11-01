/*---
description: Control for indices-arithmetic-field-history; local guarded reads preserve the same indices, logs, contents and lengths.
features: [ts-length-route-indices, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-unions]
---*/
// Control: each indexed read follows a fresh local length check with no intervening mutation or call.
const shapes: number[][] = [[], [11], [11, 22, 33], [11, 22, 33, 44]];
const expectedLog: (number | string | undefined)[][] = [[0, -1, undefined, 0, 0, 0, undefined, 0, 0, NaN, undefined, 0, 0, 1, undefined, 0, 0, -0, undefined, 0, 1, -1, undefined, 0, 1, 0, undefined, 0, 1, NaN, undefined, 0, 1, 1, undefined, 0, 1, -0, undefined, 0, 2, -1, undefined, 0, 2, 0, undefined, 0, 2, NaN, undefined, 0, 2, 1, undefined, 0, 2, -0, undefined, 0], [0, 0, 11, 1, 0, 0.5, undefined, 1, 0, NaN, undefined, 1, 0, 2, undefined, 1, 0, -0, 11, 1, 1, 0, undefined, 0, 1, 0.5, undefined, 0, 1, NaN, undefined, 0, 1, 2, undefined, 0, 1, -0, undefined, 0, 2, 0, 100, 2, 2, 0.5, undefined, 2, 2, NaN, undefined, 2, 2, 2, undefined, 2, 2, -0, 100, 2], [0, 2, 33, 3, 0, 1.5, undefined, 3, 0, NaN, undefined, 3, 0, 4, undefined, 3, 0, -0, 11, 3, 1, 2, undefined, 1, 1, 1.5, undefined, 1, 1, NaN, undefined, 1, 1, 4, undefined, 1, 1, -0, 11, 1, 2, 2, 102, 6, 2, 1.5, undefined, 6, 2, NaN, undefined, 6, 2, 4, 104, 6, 2, -0, 11, 6], [0, 3, 44, 4, 0, 2, 33, 4, 0, NaN, undefined, 4, 0, 5, undefined, 4, 0, -0, 11, 4, 1, 3, undefined, 2, 1, 2, undefined, 2, 1, NaN, undefined, 2, 1, 5, undefined, 2, 1, -0, 11, 2, 2, 3, 103, 8, 2, 2, 102, 8, 2, NaN, undefined, 8, 2, 5, 105, 8, 2, -0, 11, 8]];
const expectedContents: number[][] = [[], [100, 101], [11, 101, 102, 103, 104, 105], [11, 22, 102, 103, 104, 105, 106, 107]];
const expectedLengths: number[] = [0, 2, 6, 8];
for (const shape of [0, 1, 2, 3]) {
  const items: number[] = shapes[shape].slice(); const saved = items.length;
  const log: (number | string | undefined)[] = [];
  for (const phase of [0, 1, 2]) {
    if (phase === 1) items.length = Math.floor(saved / 2);
    if (phase === 2) while (items.length < saved * 2) items.push(100 + items.length);
    for (const index of [saved - 1, saved / 2, (saved - saved) / (saved - saved), saved + 1, -0]) {
      const length = items.length;
      const value: number | undefined = index >= 0 && index < length && index % 1 === 0 ? items[index] : undefined;
      log.push(phase, index, value, length);
    }
  }
  assert.compareArray(log, expectedLog[shape]); assert.compareArray(items, expectedContents[shape]);
  assert.sameValue(items.length, expectedLengths[shape]);
}
