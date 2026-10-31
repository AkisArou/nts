/*---
description: A last-use argument moved into a thrown payload is not released again during unwind.
features: [ts-lifetime-move, ts-route-throw, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects, ts-errors, ts-class, ts-class-fields, ts-narrowing]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: throw transfers both payload references out of the consuming callee; Node keeps their identity.
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
class Raised {
  item: Cell; same: Cell;
  constructor(item: Cell) { this.item = item; this.same = item; }
}
function raise(item: Cell): never { throw new Raised(item); }
function prepare(n: number): never { const item = make(n); raise(item); }
for (let n = 0; n < 256; n++) {
  let caught = false;
  try { prepare(n); }
  catch (error) {
    if (!(error instanceof Raised)) throw error;
    caught = true;
    churn(n);
    check(error.item, error.same, n);
  }
  assert.sameValue(caught, true);
}
