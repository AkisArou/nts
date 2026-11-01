/*---
description: A typed reader closure sees a reassigned last index and the changed array length after truncation and regrowth.
features: [ts-length-route-indices, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-unions, ts-closures, ts-function-types, ts-arrow-functions]
---*/
// Route: a captured numeric index starts at length minus one, is rebound after a shrink, and is read again after growth; node keeps both bindings live.
const shapes: number[][] = [[], [11], [11, 22, 33], [11, 22, 33, 44]];
const expectedLog: (number | string | undefined)[][] = [[0, -1, undefined, 0, 1, -1, undefined, 0, 2, -1, undefined, 0, 3, -1, undefined, 0], [0, 0, 11, 1, 1, 0, undefined, 0, 2, -1, undefined, 0, 3, -1, undefined, 2], [0, 2, 33, 3, 1, 2, undefined, 1, 2, 0, 11, 1, 3, 0, 11, 6], [0, 3, 44, 4, 1, 3, undefined, 2, 2, 1, 22, 2, 3, 1, 22, 8]];
const expectedContents: number[][] = [[], [100, 101], [11, 101, 102, 103, 104, 105], [11, 22, 102, 103, 104, 105, 106, 107]];
const expectedLengths: number[] = [0, 2, 6, 8];
for (const shape of [0, 1, 2, 3]) {
  const items: number[] = shapes[shape].slice(); const saved = items.length; let index: number = saved - 1;
  const log: (number | string | undefined)[] = [];
  const read: (phase: number) => void = phase => { const value: number | undefined = items[index]; log.push(phase, index, value, items.length); };
  for (const phase of [0, 1, 2, 3]) {
    if (phase === 1) items.length = Math.floor(saved / 2);
    if (phase === 2) index = items.length - 1;
    if (phase === 3) while (items.length < saved * 2) items.push(100 + items.length);
    read(phase);
  }
  assert.compareArray(log, expectedLog[shape]); assert.compareArray(items, expectedContents[shape]);
  assert.sameValue(items.length, expectedLengths[shape]);
}
