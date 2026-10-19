/*---
description: A class field typed as a union holds a number, then a string, then null, each read back as itself.
features: [ts-unions, ts-class, ts-narrowing, ts-null-undefined]
---*/
class Cell {
  content: number | string | null = 0;
  describe(): string {
    if (this.content === null) return "empty";
    return typeof this.content === "number" ? `n${this.content + 1}` : `s${this.content.length}`;
  }
}
const cell = new Cell();
const seen: string[] = [cell.describe()];
cell.content = "four";
seen.push(cell.describe());
cell.content = null;
seen.push(cell.describe());
cell.content = 2.5;
seen.push(cell.describe());
assert.compareArray(seen, ["n1", "s4", "empty", "n3.5"]);
