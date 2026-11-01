/*---
description: A generic array traversal recomputes its last index after leading elements are spliced, preserving the current last value and zero-length stop.
features: [ts-length-route-indices, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-unions, ts-functions, ts-generics, ts-generic-constraints]
---*/
// Route: a generic Array<T> loses two leading entries each turn; node recomputes length minus one and stops at zero.
const shapes: number[][] = [[], [11], [11, 22, 33], [11, 22, 33, 44]];
const expectedLog: (number | string | undefined)[][] = [[], [0, 11, 1, "shift", 0], [2, 33, 3, "shift", 1, 0, 33, 1, "shift", 0], [3, 44, 4, "shift", 2, 1, 44, 2, "shift", 0]];
const expectedContents: number[][] = [[], [], [], []];
const expectedLengths: number[] = [0, 0, 0, 0];
function scanCurrent<T extends number>(items: Array<T>, log: (number | string | undefined)[]): void {
  while (items.length > 0) {
    const index = items.length - 1; const value: number | undefined = items[index]; log.push(index, value, items.length);
    items.splice(0, Math.min(2, items.length)); log.push("shift", items.length);
  }
}
for (const shape of [0, 1, 2, 3]) {
  const items: number[] = shapes[shape].slice(); const log: (number | string | undefined)[] = [];
  scanCurrent(items, log);
  assert.compareArray(log, expectedLog[shape]); assert.compareArray(items, expectedContents[shape]);
  assert.sameValue(items.length, expectedLengths[shape]);
}
