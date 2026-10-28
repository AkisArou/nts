/*---
description: generic-cell-assertion finding; the pair changes only the Claimed type alias.
features: [ts-type-aliases, ts-assertion-functions, ts-unknown]
---*/
type Claimed = number;
class Cell<T> {
  value: T;
  constructor(value: T) { this.value = value; }
}
function claim(value: unknown): asserts value is Cell<Claimed> {}
const cell: unknown = new Cell<string>("7");
claim(cell);
function describe(value: Claimed): string { return typeof value + ":" + String(value + 1); }
assert.sameValue(describe(cell.value), "string:71");
