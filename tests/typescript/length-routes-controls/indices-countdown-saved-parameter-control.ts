/*---
description: Control for indices-countdown-saved-parameter; local guarded reads preserve the same indices, logs, contents and lengths.
features: [ts-length-route-indices, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-unions]
---*/
// Control: each indexed read follows a fresh local length check with no intervening mutation or call.
const shapes: number[][] = [[], [11], [11, 22, 33], [11, 22, 33, 44]];
const expectedLog: (number | string | undefined)[][] = [["shrink", 0], ["shrink", 0, 0, undefined, 0, "zero", 0], ["shrink", 1, 2, undefined, 1, 1, undefined, 1, 0, 11, 1, "zero", 0], ["shrink", 2, 3, undefined, 2, 2, undefined, 2, 1, 22, 2, 0, 11, 2, "zero", 0]];
const expectedContents: number[][] = [[], [], [], []];
const expectedLengths: number[] = [0, 0, 0, 0];
for (const shape of [0, 1, 2, 3]) {
  const items: number[] = shapes[shape].slice(); const log: (number | string | undefined)[] = [];
  const last = items.length - 1; items.splice(Math.floor(items.length / 2)); log.push("shrink", items.length);
  for (let index = last; index >= 0; index--) {
    const length = items.length; const value: number | undefined = index < length ? items[index] : undefined;
    log.push(index, value, length);
    if (index === 0) { items.length = 0; log.push("zero", 0); }
  }
  assert.compareArray(log, expectedLog[shape]); assert.compareArray(items, expectedContents[shape]);
  assert.sameValue(items.length, expectedLengths[shape]);
}
