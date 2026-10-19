/*---
description: A template literal type over two unions names every combination, which a loop produces at run time.
features: [ts-literal-types, ts-template-literal-types, ts-unions]
---*/
type Row = "a" | "b";
type Column = 1 | 2;
type Cell = `${Row}${Column}`;
const rows: Row[] = ["a", "b"];
const columns: Column[] = [1, 2];
const cells: Cell[] = [];
for (const row of rows) for (const column of columns) cells.push(`${row}${column}`);
assert.compareArray(cells, ["a1", "a2", "b1", "b2"]);
