/*---
description: Map aliases survive a later consuming transfer of their original object.
features: [ts-lifetime-move, ts-route-container, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects, ts-map-set]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: two map entries own the value independently of the final handoff; Node preserves both fields.
type Cell = { id: number; text: string };
function make(id: number): Cell { return { id, text: "cell/" + id }; }
function consume(item: Cell): number {
  const destination: Cell[] = [];
  destination.push(item);
  const checksum = destination[0].id + destination[0].text.length;
  destination.length = 0;
  return checksum;
}
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
function prepare(n: number): Map<number, Cell> {
  const item = make(n);
  const saved = new Map<number, Cell>();
  saved.set(0, item);
  saved.set(1, item);
  const expected = item.id + item.text.length;
  assert.sameValue(consume(item), expected);
  return saved;
}
for (let n = 0; n < 256; n++) {
  const saved = prepare(n);
  churn(n);
  const kept = saved.get(0), same = saved.get(1);
  if (kept === undefined || same === undefined) throw new Error("lost map value");
  assert.sameValue(saved.size, 2);
  check(kept, same, n);
}
