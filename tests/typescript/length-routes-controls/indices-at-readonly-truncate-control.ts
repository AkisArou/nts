/*---
description: Control for indices-at-readonly-truncate; local guarded reads preserve the same indices, logs, contents and lengths.
features: [ts-length-route-indices, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-unions]
---*/
// Control: each indexed read follows a fresh local length check with no intervening mutation or call.
const shapes: number[][] = [[], [11], [11, 22, 33], [11, 22, 33, 44]];
const expectedLog: (number | string | undefined)[][] = [[0, -1, undefined, 0, 0, -2, undefined, 0, 0, -0, undefined, 0, 0, -1, undefined, 0, 0, -0.5, undefined, 0, 0, NaN, undefined, 0, 0, -Infinity, undefined, 0, 1, -1, undefined, 0, 1, -2, undefined, 0, 1, -0, undefined, 0, 1, -1, undefined, 0, 1, -0.5, undefined, 0, 1, NaN, undefined, 0, 1, -Infinity, undefined, 0, 2, -1, undefined, 0, 2, -2, undefined, 0, 2, -0, undefined, 0, 2, -1, undefined, 0, 2, -0.5, undefined, 0, 2, NaN, undefined, 0, 2, -Infinity, undefined, 0], [0, -1, 11, 1, 0, -2, undefined, 1, 0, -1, 11, 1, 0, -2, undefined, 1, 0, -0.5, 11, 1, 0, NaN, 11, 1, 0, -Infinity, undefined, 1, 1, -1, undefined, 0, 1, -2, undefined, 0, 1, -1, undefined, 0, 1, -2, undefined, 0, 1, -0.5, undefined, 0, 1, NaN, undefined, 0, 1, -Infinity, undefined, 0, 2, -1, undefined, 0, 2, -2, undefined, 0, 2, -1, undefined, 0, 2, -2, undefined, 0, 2, -0.5, undefined, 0, 2, NaN, undefined, 0, 2, -Infinity, undefined, 0], [0, -1, 33, 3, 0, -2, 22, 3, 0, -3, 11, 3, 0, -4, undefined, 3, 0, -0.5, 11, 3, 0, NaN, 11, 3, 0, -Infinity, undefined, 3, 1, -1, 11, 1, 1, -2, undefined, 1, 1, -3, undefined, 1, 1, -4, undefined, 1, 1, -0.5, 11, 1, 1, NaN, 11, 1, 1, -Infinity, undefined, 1, 2, -1, undefined, 0, 2, -2, undefined, 0, 2, -3, undefined, 0, 2, -4, undefined, 0, 2, -0.5, undefined, 0, 2, NaN, undefined, 0, 2, -Infinity, undefined, 0], [0, -1, 44, 4, 0, -2, 33, 4, 0, -4, 11, 4, 0, -5, undefined, 4, 0, -0.5, 11, 4, 0, NaN, 11, 4, 0, -Infinity, undefined, 4, 1, -1, 22, 2, 1, -2, 11, 2, 1, -4, undefined, 2, 1, -5, undefined, 2, 1, -0.5, 11, 2, 1, NaN, 11, 2, 1, -Infinity, undefined, 2, 2, -1, undefined, 0, 2, -2, undefined, 0, 2, -4, undefined, 0, 2, -5, undefined, 0, 2, -0.5, undefined, 0, 2, NaN, undefined, 0, 2, -Infinity, undefined, 0]];
const expectedContents: number[][] = [[], [], [], []];
const expectedLengths: number[] = [0, 0, 0, 0];
for (const shape of [0, 1, 2, 3]) {
  const items: number[] = shapes[shape].slice(); const saved = items.length;
  const log: (number | string | undefined)[] = [];
  for (const phase of [0, 1, 2]) {
    if (phase === 1) items.length = Math.floor(saved / 2);
    if (phase === 2) items.length = 0;
    for (const offset of [-1, -2, -saved, -saved - 1, -0.5, NaN, -Infinity]) {
      const relative = offset === offset ? Math.trunc(offset) : 0; const length = items.length;
      const index = relative < 0 ? length + relative : relative;
      const value: number | undefined = index >= 0 && index < length ? items[index] : undefined;
      log.push(phase, offset, value, length);
    }
  }
  assert.compareArray(log, expectedLog[shape]); assert.compareArray(items, expectedContents[shape]);
  assert.sameValue(items.length, expectedLengths[shape]);
}
