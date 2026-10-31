/*---
description: A finalizer still owns the local used by a consuming store on the normal path.
features: [ts-lifetime-move, ts-route-throw, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects, ts-errors]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: finally keeps the object after the destination clears; Node preserves its original identity and fields.
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
function prepare(n: number, saved: Cell[]): void {
  const item = make(n);
  const expected = item.id + item.text.length;
  try { assert.sameValue(consume(item), expected); }
  finally { saved.push(item, item); }
}
for (let n = 0; n < 256; n++) {
  const saved: Cell[] = [];
  prepare(n, saved);
  churn(n);
  assert.sameValue(saved.length, 2);
  check(saved[0], saved[1], n);
}
