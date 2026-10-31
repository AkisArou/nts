/*---
description: Captures own an object independently of its final handoff to a consuming call.
features: [ts-lifetime-move, ts-route-closure, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects, ts-closures, ts-tuples]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: two stored readers retain the local before its last direct use; Node preserves identity and fields.
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
function prepare(n: number): [() => Cell, () => Cell] {
  const item = make(n);
  const readers: [() => Cell, () => Cell] = [() => item, () => item];
  const expected = item.id + item.text.length;
  assert.sameValue(consume(item), expected);
  return readers;
}
for (let n = 0; n < 256; n++) {
  const readers = prepare(n);
  churn(n);
  check(readers[0](), readers[1](), n);
}
