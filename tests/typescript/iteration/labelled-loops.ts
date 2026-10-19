/*---
description: Labelled break and continue leave or advance an outer loop from an inner one.
features: [ts-iteration]
---*/
const grid: number[][] = [[1, 2, 3], [4, -1, 6], [7, 8, 9]];
const visited: number[] = [];
rows: for (const row of grid) {
  for (const cell of row) {
    if (cell === 2) continue rows;
    if (cell === 8) break rows;
    if (cell < 0) continue;
    visited.push(cell);
  }
}
assert.compareArray(visited, [1, 4, 6, 7]);
