/*---
description: Iterator result fields each own a reference after one returned owner is dropped.
features: [ts-lifetime-move, ts-route-iterator, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects, ts-class, ts-class-fields, ts-tuples]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: next hands out three aliases and the caller drops one; Node keeps the other two through later calls.
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
class Cursor implements Iterator<[Cell, Cell, Cell]> {
  index: number;
  constructor(index: number) { this.index = index; }
  next(): IteratorResult<[Cell, Cell, Cell]> {
    const item = make(this.index++);
    return { done: false, value: [item, item, item] };
  }
}
for (let n = 0; n < 256; n++) {
  const cursor = new Cursor(n);
  const result = cursor.next();
  if (result.done) throw new Error("missing triple");
  result.value[0] = make(-1);
  for (let i = 0; i < 24; i++) cursor.next();
  churn(n);
  assert.sameValue(result.value.length, 3);
  assert.sameValue(result.value[0].id, -1);
  assert.sameValue(result.value[0].text, "cell/-1");
  assert.sameValue(result.value[0].text.length, 7);
  check(result.value[1], result.value[2], n);
}
