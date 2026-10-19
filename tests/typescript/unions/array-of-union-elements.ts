/*---
description: An array whose element type is a union holds numbers and strings side by side, each narrowed on read.
features: [ts-unions, ts-narrowing]
---*/
const cells: (number | string)[] = [1, "a", 2.5, "bc"];
cells.push(3);
cells[1] = 10;
let numbers = 0;
let letters = "";
for (const cell of cells) {
  if (typeof cell === "number") numbers += cell;
  else letters += cell;
}
assert.sameValue(numbers, 16.5);
assert.sameValue(letters, "bc");
assert.sameValue(cells.length, 5);
