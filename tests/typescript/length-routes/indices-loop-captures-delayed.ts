/*---
description: Retained typed closures read their own iteration indices after the same array shrinks, regrows and becomes empty.
features: [ts-length-route-indices, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-unions, ts-closures, ts-function-types, ts-arrow-functions]
---*/
// Route: typed closures capture each let index before mutation; node later reads the current array at each distinct retained index.
const shapes: number[][] = [[], [11], [11, 22, 33], [11, 22, 33, 44]];
const expectedLog: (number | string | undefined)[][] = [[0, 0, undefined, 0, 1, 0, undefined, 0, 2, 0, undefined, 0], [0, 0, undefined, 0, 0, 1, undefined, 0, 1, 0, 100, 2, 1, 1, 101, 2, 2, 0, undefined, 0, 2, 1, undefined, 0], [0, 0, 11, 1, 0, 1, undefined, 1, 0, 2, undefined, 1, 0, 3, undefined, 1, 1, 0, 11, 6, 1, 1, 101, 6, 1, 2, 102, 6, 1, 3, 103, 6, 2, 0, undefined, 0, 2, 1, undefined, 0, 2, 2, undefined, 0, 2, 3, undefined, 0], [0, 0, 11, 2, 0, 1, 22, 2, 0, 2, undefined, 2, 0, 3, undefined, 2, 0, 4, undefined, 2, 1, 0, 11, 8, 1, 1, 22, 8, 1, 2, 102, 8, 1, 3, 103, 8, 1, 4, 104, 8, 2, 0, undefined, 0, 2, 1, undefined, 0, 2, 2, undefined, 0, 2, 3, undefined, 0, 2, 4, undefined, 0]];
const expectedContents: number[][] = [[], [], [], []];
const expectedLengths: number[] = [0, 0, 0, 0];
for (const shape of [0, 1, 2, 3]) {
  const items: number[] = shapes[shape].slice(); const saved = items.length; let phase: number = 0;
  const log: (number | string | undefined)[] = []; const readers: (() => void)[] = [];
  for (let index = 0; index <= saved; index++) {
    readers.push(() => { const value: number | undefined = items[index]; log.push(phase, index, value, items.length); });
  }
  for (phase = 0; phase < 3; phase++) {
    if (phase === 0) items.length = Math.floor(saved / 2);
    if (phase === 1) while (items.length < saved * 2) items.push(100 + items.length);
    if (phase === 2) items.length = 0;
    for (const read of readers) read();
  }
  assert.compareArray(log, expectedLog[shape]); assert.compareArray(items, expectedContents[shape]);
  assert.sameValue(items.length, expectedLengths[shape]);
}
