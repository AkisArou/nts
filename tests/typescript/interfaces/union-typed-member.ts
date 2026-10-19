/*---
description: An interface member typed as a union holds a different member type in each implementation.
features: [ts-interfaces, ts-unions, ts-narrowing]
---*/
interface Cell {
  content: number | string | null;
}
function render(cell: Cell): string {
  if (cell.content === null) return "-";
  if (typeof cell.content === "number") return cell.content.toFixed(1);
  return cell.content;
}
const row: Cell[] = [{ content: 1 }, { content: "two" }, { content: null }];
assert.sameValue(row.map(render).join("|"), "1.0|two|-");
row[0].content = "now text";
assert.sameValue(render(row[0]), "now text");
