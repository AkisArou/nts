/*---
description: Re-entry can save both active values before their respective last-use consuming calls.
features: [ts-lifetime-move, ts-route-re-entry, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects, ts-closures]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: a callback re-enters the producer and keeps both invocations; Node preserves their distinct identities.
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
function transfer(n: number, depth: number, saved: Cell[]): void {
  const item = make(n);
  const again = (): void => {
    saved[depth * 2] = item;
    saved[depth * 2 + 1] = item;
    if (depth > 0) transfer(n + 1, depth - 1, saved);
  };
  again();
  const expected = item.id + item.text.length;
  assert.sameValue(consume(item), expected);
}
for (let n = 0; n < 256; n++) {
  const saved: Cell[] = [];
  transfer(n, 1, saved);
  churn(n);
  check(saved[0], saved[1], n + 1);
  check(saved[2], saved[3], n);
  assert.sameValue(saved[0] === saved[2], false);
}
