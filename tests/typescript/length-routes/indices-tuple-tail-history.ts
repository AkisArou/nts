/*---
description: A tuple with an optional first slot and rest tail distinguishes a saved last index from its new end after pop and unshift.
features: [ts-length-route-indices, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-unions, ts-tuples]
---*/
// Route: an optional/rest tuple loses its tail then gains two leading elements; node resolves saved, current-last and past-end indices at each stage.
const shapes: number[][] = [[], [11], [11, 22, 33], [11, 22, 33, 44]];
const expectedLog: (number | string | undefined)[][] = [[0, -1, undefined, 0, 0, -1, undefined, 0, 0, 0, undefined, 0, 1, -1, undefined, 0, 1, -1, undefined, 0, 1, 0, undefined, 0, 2, -1, undefined, 2, 2, 1, 72, 2, 2, 2, undefined, 2], [0, 0, 11, 1, 0, 0, 11, 1, 0, 1, undefined, 1, 1, 0, undefined, 0, 1, -1, undefined, 0, 1, 0, undefined, 0, 2, 0, 71, 2, 2, 1, 72, 2, 2, 2, undefined, 2], [0, 2, 33, 3, 0, 2, 33, 3, 0, 3, undefined, 3, 1, 2, undefined, 2, 1, 1, 22, 2, 1, 2, undefined, 2, 2, 2, 11, 4, 2, 3, 22, 4, 2, 4, undefined, 4], [0, 3, 44, 4, 0, 3, 44, 4, 0, 4, undefined, 4, 1, 3, undefined, 3, 1, 2, 33, 3, 1, 3, undefined, 3, 2, 3, 22, 5, 2, 4, 33, 5, 2, 5, undefined, 5]];
const expectedContents: number[][] = [[71, 72], [71, 72], [71, 72, 11, 22], [71, 72, 11, 22, 33]];
const expectedLengths: number[] = [2, 2, 4, 5];
for (const shape of [0, 1, 2, 3]) {
  const items: [number?, ...number[]] = shapes[shape].slice(); const saved = items.length - 1;
  const log: (number | string | undefined)[] = [];
  for (const phase of [0, 1, 2]) {
    if (phase === 1) items.pop();
    if (phase === 2) items.unshift(71, 72);
    for (const index of [saved, items.length - 1, items.length]) {
      const value: number | undefined = items[index]; log.push(phase, index, value, items.length);
    }
  }
  assert.compareArray(log, expectedLog[shape]); assert.compareArray(items, expectedContents[shape]);
  assert.sameValue(items.length, expectedLengths[shape]);
}
