/*---
description: Async-frame aliases remain owners after another local name is consumed.
features: [ts-lifetime-move, ts-route-await, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects, ts-async]
flags: [async]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: await carries two aliases beyond the last direct handoff; Node resumes with the original object.
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
async function read(n: number): Promise<void> {
  const item = make(n);
  const kept = item, same = item;
  const expected = item.id + item.text.length;
  assert.sameValue(consume(item), expected);
  await Promise.resolve();
  churn(n);
  check(kept, same, n);
}
async function main(): Promise<void> {
  for (let n = 0; n < 256; n++) await read(n);
}
main().then(() => $DONE(), $DONE);
