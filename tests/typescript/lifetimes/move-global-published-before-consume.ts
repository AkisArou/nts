/*---
description: A module publication owns an object separately from its final consuming call.
features: [ts-lifetime-move, ts-route-global, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects, ts-modules]
flags: [module]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: module slots retain two aliases before the local moves; Node preserves them after the call returns.
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
let kept: Cell = make(-1), same: Cell = kept;
function prepare(n: number): void {
  const item = make(n);
  kept = item;
  same = item;
  const expected = item.id + item.text.length;
  assert.sameValue(consume(item), expected);
}
for (let n = 0; n < 256; n++) {
  prepare(n);
  churn(n);
  check(kept, same, n);
}
