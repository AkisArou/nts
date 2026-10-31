/*---
description: Default parameter aliases each keep a reference when the first parameter is consumed.
features: [ts-lifetime-move, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects, ts-default-parameters]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: omitted defaults alias the first parameter before its last direct use; Node keeps their shared object.
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
function read(item: Cell, n: number, kept: Cell = item, same: Cell = item): void {
  const expected = item.id + item.text.length;
  assert.sameValue(consume(item), expected);
  churn(n);
  check(kept, same, n);
}
for (let n = 0; n < 256; n++) read(make(n), n);
