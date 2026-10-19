/*---
description: An interface with a number index signature types an array-like object read by numeric keys.
features: [ts-interfaces, ts-index-signatures]
---*/
interface Row {
  [column: number]: string;
  length: number;
}
const row: Row = { 0: "a", 1: "b", 2: "c", length: 3 };
const cells: string[] = [];
for (let i = 0; i < row.length; i++) cells.push(row[i]);
assert.sameValue(cells.join(""), "abc");
assert.sameValue(row["1"], "b");
assert.sameValue(Array.from(row).join("-"), "a-b-c");
