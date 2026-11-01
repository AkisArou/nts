/*---
description: Control for indices-loop-captures-delayed; local guarded reads preserve the same indices, logs, contents and lengths.
features: [ts-length-route-indices, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-unions]
---*/
// Control: each indexed read follows a fresh local length check with no intervening mutation or call.
const shapes: number[][] = [[], [11], [11, 22, 33], [11, 22, 33, 44]];
const expectedLog: (number | string | undefined)[][] = [[0, 0, undefined, 0, 1, 0, undefined, 0, 2, 0, undefined, 0], [0, 0, undefined, 0, 0, 1, undefined, 0, 1, 0, 100, 2, 1, 1, 101, 2, 2, 0, undefined, 0, 2, 1, undefined, 0], [0, 0, 11, 1, 0, 1, undefined, 1, 0, 2, undefined, 1, 0, 3, undefined, 1, 1, 0, 11, 6, 1, 1, 101, 6, 1, 2, 102, 6, 1, 3, 103, 6, 2, 0, undefined, 0, 2, 1, undefined, 0, 2, 2, undefined, 0, 2, 3, undefined, 0], [0, 0, 11, 2, 0, 1, 22, 2, 0, 2, undefined, 2, 0, 3, undefined, 2, 0, 4, undefined, 2, 1, 0, 11, 8, 1, 1, 22, 8, 1, 2, 102, 8, 1, 3, 103, 8, 1, 4, 104, 8, 2, 0, undefined, 0, 2, 1, undefined, 0, 2, 2, undefined, 0, 2, 3, undefined, 0, 2, 4, undefined, 0]];
const expectedContents: number[][] = [[], [], [], []];
const expectedLengths: number[] = [0, 0, 0, 0];
for (const shape of [0, 1, 2, 3]) {
  const items: number[] = shapes[shape].slice(); const saved = items.length;
  const log: (number | string | undefined)[] = [];
  for (let phase = 0; phase < 3; phase++) {
    if (phase === 0) items.length = Math.floor(saved / 2);
    if (phase === 1) while (items.length < saved * 2) items.push(100 + items.length);
    if (phase === 2) items.length = 0;
    for (let index = 0; index <= saved; index++) {
      const length = items.length; const value: number | undefined = index < length ? items[index] : undefined;
      log.push(phase, index, value, length);
    }
  }
  assert.compareArray(log, expectedLog[shape]); assert.compareArray(items, expectedContents[shape]);
  assert.sameValue(items.length, expectedLengths[shape]);
}
