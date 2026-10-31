/*---
description: Iterator next results own elements borrowed from their iterator source.
features: [ts-lifetime-borrow, ts-route-iterator, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings, ts-class, ts-class-fields]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: two next results outlive the truncated source; Node preserves the element identity and contents.
type Cell = { id: number; text: string };
function make(id: number): Cell { return { id, text: "cell/" + id }; }
function churn(seed: number): void {
  const rows: Cell[] = [];
  for (let i = 0; i < 24; i++) rows.push(make(seed + 1000 + i));
  let sum = 0;
  for (const row of rows) sum += row.id + row.text.length;
  assert.sameValue(sum, 24 * (seed + 1000) + 492);
}
function check(value: Cell, same: Cell, n: number): void {
  assert.sameValue(value === same, true);
  assert.sameValue(value.id, n);
  assert.sameValue(value.text, "cell/" + n);
  assert.sameValue(value.text.length, ("cell/" + n).length);
}
class Cursor implements Iterator<Cell> {
  source: Cell[];
  constructor(source: Cell[]) { this.source = source; }
  next(): IteratorResult<Cell> { return { done: false, value: this.source[0] }; }
}
for (let n = 0; n < 256; n++) {
  const source = [make(n)];
  const cursor = new Cursor(source);
  const kept = cursor.next(), same = cursor.next();
  source.length = 0;
  churn(n);
  if (kept.done || same.done) throw new Error("missing iterator value");
  check(kept.value, same.value, n);
}
