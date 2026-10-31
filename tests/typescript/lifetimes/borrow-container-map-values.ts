/*---
description: Map values own a borrowed array element after the array is cleared.
features: [ts-lifetime-borrow, ts-route-container, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings, ts-map-set]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: two map entries keep the element; Node preserves its identity and contents.
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
function collect(source: Cell[], saved: Map<number, Cell>): void {
  const item = source[0];
  saved.set(0, item);
  saved.set(1, item);
}
for (let n = 0; n < 256; n++) {
  const source = [make(n)];
  const saved = new Map<number, Cell>();
  collect(source, saved);
  source.length = 0;
  churn(n);
  const value = saved.get(0), same = saved.get(1);
  if (value === undefined || same === undefined) throw new Error("missing borrow");
  assert.sameValue(saved.size, 2);
  check(value, same, n);
}
