/*---
description: A narrowed optional array resolves cached edge indices against replacement arrays while preserving the absent branch between them.
features: [ts-length-route-indices, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-unions]
---*/
// Route: a number-array-or-undefined binding is replaced by empty, absent and doubled values; node uses the current narrowed array at cached indices.
const shapes: number[][] = [[], [11], [11, 22, 33], [11, 22, 33, 44]];
const expectedLog: (number | string | undefined)[][] = [[0, -1, undefined, 0, 0, 0, undefined, 0, 0, -0.5, undefined, 0, 1, -1, undefined, 0, 1, 0, undefined, 0, 1, -0.5, undefined, 0, 2, "absent", 3, -1, undefined, 0, 3, 0, undefined, 0, 3, -0.5, undefined, 0], [0, 0, 11, 1, 0, 1, undefined, 1, 0, 0, 11, 1, 1, 0, undefined, 0, 1, 1, undefined, 0, 1, 0, undefined, 0, 2, "absent", 3, 0, 100, 2, 3, 1, 101, 2, 3, 0, 100, 2], [0, 2, 33, 3, 0, 3, undefined, 3, 0, 1, 22, 3, 1, 2, undefined, 0, 1, 3, undefined, 0, 1, 1, undefined, 0, 2, "absent", 3, 2, 102, 6, 3, 3, 103, 6, 3, 1, 101, 6], [0, 3, 44, 4, 0, 4, undefined, 4, 0, 1.5, undefined, 4, 1, 3, undefined, 0, 1, 4, undefined, 0, 1, 1.5, undefined, 0, 2, "absent", 3, 3, 103, 8, 3, 4, 104, 8, 3, 1.5, undefined, 8]];
const expectedContents: number[][] = [[], [100, 101], [100, 101, 102, 103, 104, 105], [100, 101, 102, 103, 104, 105, 106, 107]];
const expectedLengths: number[] = [0, 2, 6, 8];
for (const shape of [0, 1, 2, 3]) {
  let items: number[] | undefined = shapes[shape].slice(); const initial = items.length; const saved = initial - 1;
  const log: (number | string | undefined)[] = [];
  for (const phase of [0, 1, 2, 3]) {
    if (phase === 1) items = [];
    if (phase === 2) items = undefined;
    if (phase === 3) { items = []; for (let index = 0; index < initial * 2; index++) items.push(100 + index); }
    if (items !== undefined) {
      for (const index of [saved, saved + 1, saved / 2]) { const value: number | undefined = items[index]; log.push(phase, index, value, items.length); }
    } else log.push(phase, "absent");
  }
  assert.compareArray(log, expectedLog[shape]); assert.sameValue(items === undefined, false);
  if (items !== undefined) { assert.compareArray(items, expectedContents[shape]); assert.sameValue(items.length, expectedLengths[shape]); }
}
