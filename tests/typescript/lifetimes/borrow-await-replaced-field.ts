/*---
description: A field borrow lives across await even when its original owner changes while suspended.
features: [ts-lifetime-borrow, ts-route-await, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings, ts-async]
flags: [async]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: the async frame retains two borrowed reads across suspension; Node resumes with the old object.
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
async function read(owner: { item: Cell }, n: number): Promise<void> {
  const kept = owner.item, same = owner.item;
  await Promise.resolve();
  churn(n);
  check(kept, same, n);
}
async function main(): Promise<void> {
  for (let n = 0; n < 256; n++) {
    const owner = { item: make(n) };
    const pending = read(owner, n);
    owner.item = make(-n - 1);
    await pending;
  }
}
main().then(() => $DONE(), $DONE);
