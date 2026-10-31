/*---
description: A thrown payload owns the parameter its callee borrowed before unwinding.
features: [ts-lifetime-borrow, ts-route-throw, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings, ts-errors, ts-class, ts-class-fields, ts-narrowing]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: the raised object carries two aliases across owner clearing in finally; Node retains both fields.
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
for (let n = 0; n < 256; n++) {
  const owner = { item: make(n) };
  let caught = false;
  try {
    try { raise(owner.item); } finally { owner.item = make(-n - 1); }
  } catch (error) {
    if (!(error instanceof Raised)) throw error;
    caught = true;
    churn(n);
    check(error.item, error.same, n);
  }
  assert.sameValue(caught, true);
}
