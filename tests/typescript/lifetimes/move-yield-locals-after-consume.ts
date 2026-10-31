/*---
description: Generator-frame aliases remain owners after another local name is consumed.
features: [ts-lifetime-move, ts-route-yield, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects, ts-generators]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: yield carries two aliases past the consuming handoff; Node resumes with the original identity and fields.
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
function* read(n: number): Generator<number, void, unknown> {
  const item = make(n);
  const kept = item, same = item;
  const expected = item.id + item.text.length;
  assert.sameValue(consume(item), expected);
  yield n;
  check(kept, same, n);
}
for (let n = 0; n < 256; n++) {
  const iterator = read(n);
  assert.sameValue(iterator.next().value, n);
  churn(n);
  assert.sameValue(iterator.next().done, true);
}
