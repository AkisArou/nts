/*---
description: A generator last return moves its object into the result without consuming the previous result alias.
features: [ts-lifetime-move, ts-route-iterator, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects, ts-generators]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: next hands out an object twice and finishes its frame; Node preserves both result references.
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
function* transfer(n: number): Generator<Cell, Cell, unknown> {
  const item = make(n);
  yield item;
  return item;
}
for (let n = 0; n < 256; n++) {
  const iterator = transfer(n);
  const first = iterator.next(), last = iterator.next();
  assert.sameValue(first.done, false);
  assert.sameValue(last.done, true);
  churn(n);
  check(first.value, last.value, n);
}
