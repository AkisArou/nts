/*---
description: Control for indices-union-replacement; local guarded reads preserve the same indices, logs, contents and lengths.
features: [ts-length-route-indices, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-unions]
---*/
// Control: each indexed read follows a fresh local length check with no intervening mutation or call.
const shapes: number[][] = [[], [11], [11, 22, 33], [11, 22, 33, 44]];
const expectedLog: (number | string | undefined)[][] = [[0, -1, undefined, 0, 0, 0, undefined, 0, 0, -0.5, undefined, 0, 1, -1, undefined, 0, 1, 0, undefined, 0, 1, -0.5, undefined, 0, 2, "absent", 3, -1, undefined, 0, 3, 0, undefined, 0, 3, -0.5, undefined, 0], [0, 0, 11, 1, 0, 1, undefined, 1, 0, 0, 11, 1, 1, 0, undefined, 0, 1, 1, undefined, 0, 1, 0, undefined, 0, 2, "absent", 3, 0, 100, 2, 3, 1, 101, 2, 3, 0, 100, 2], [0, 2, 33, 3, 0, 3, undefined, 3, 0, 1, 22, 3, 1, 2, undefined, 0, 1, 3, undefined, 0, 1, 1, undefined, 0, 2, "absent", 3, 2, 102, 6, 3, 3, 103, 6, 3, 1, 101, 6], [0, 3, 44, 4, 0, 4, undefined, 4, 0, 1.5, undefined, 4, 1, 3, undefined, 0, 1, 4, undefined, 0, 1, 1.5, undefined, 0, 2, "absent", 3, 3, 103, 8, 3, 4, 104, 8, 3, 1.5, undefined, 8]];
const expectedContents: number[][] = [[], [100, 101], [100, 101, 102, 103, 104, 105], [100, 101, 102, 103, 104, 105, 106, 107]];
const expectedLengths: number[] = [0, 2, 6, 8];
for (const shape of [0, 1, 2, 3]) {
  const items: number[] = shapes[shape].slice(); const initial = items.length; const saved = initial - 1; let present = true;
  const log: (number | string | undefined)[] = [];
  for (const phase of [0, 1, 2, 3]) {
    if (phase === 1) items.length = 0;
    if (phase === 2) present = false;
    if (phase === 3) { present = true; items.length = 0; for (let index = 0; index < initial * 2; index++) items.push(100 + index); }
    if (present) {
      for (const index of [saved, saved + 1, saved / 2]) {
        const length = items.length;
        const value: number | undefined = index >= 0 && index < length && index % 1 === 0 ? items[index] : undefined;
        log.push(phase, index, value, length);
      }
    } else log.push(phase, "absent");
  }
  assert.compareArray(log, expectedLog[shape]); assert.sameValue(!present, false);
  assert.compareArray(items, expectedContents[shape]); assert.sameValue(items.length, expectedLengths[shape]);
}
