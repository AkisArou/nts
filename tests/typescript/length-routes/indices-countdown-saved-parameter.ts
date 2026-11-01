/*---
description: A countdown saved from a number-array parameter before splicing visits removed tail indices as undefined and the remaining prefix exactly once.
features: [ts-length-route-indices, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-unions, ts-functions]
---*/
// Route: a number-array parameter saves length minus one, is halved, then counts down and finally clears; node retains the original index schedule.
const shapes: number[][] = [[], [11], [11, 22, 33], [11, 22, 33, 44]];
const expectedLog: (number | string | undefined)[][] = [["shrink", 0], ["shrink", 0, 0, undefined, 0, "zero", 0], ["shrink", 1, 2, undefined, 1, 1, undefined, 1, 0, 11, 1, "zero", 0], ["shrink", 2, 3, undefined, 2, 2, undefined, 2, 1, 22, 2, 0, 11, 2, "zero", 0]];
const expectedContents: number[][] = [[], [], [], []];
const expectedLengths: number[] = [0, 0, 0, 0];
function scanSaved(items: number[], log: (number | string | undefined)[]): void {
  const last = items.length - 1; items.splice(Math.floor(items.length / 2)); log.push("shrink", items.length);
  for (let index = last; index >= 0; index--) {
    const value: number | undefined = items[index]; log.push(index, value, items.length);
    if (index === 0) { items.length = 0; log.push("zero", 0); }
  }
}
for (const shape of [0, 1, 2, 3]) {
  const items: number[] = shapes[shape].slice(); const log: (number | string | undefined)[] = [];
  scanSaved(items, log);
  assert.compareArray(log, expectedLog[shape]); assert.compareArray(items, expectedContents[shape]);
  assert.sameValue(items.length, expectedLengths[shape]);
}
