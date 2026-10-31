/*---
description: An argument getter may retain an object before its consuming call starts.
features: [ts-lifetime-move, ts-route-hook, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects, ts-accessors, ts-closures]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: the implicit getter saves aliases during argument evaluation; Node retains them after consumption.
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
function accept(item: Cell, tag: number): void {
  const expected = item.id + item.text.length;
  assert.sameValue(consume(item), expected);
  assert.sameValue(tag, 1);
}
function prepare(n: number): Cell[] {
  const item = make(n);
  const saved: Cell[] = [];
  const hook = { get tag(): number { saved.push(item, item); return 1; } };
  accept(item, hook.tag);
  return saved;
}
for (let n = 0; n < 256; n++) {
  const saved = prepare(n);
  churn(n);
  check(saved[0], saved[1], n);
}
